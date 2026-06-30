import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { SupabaseAdminClient } from '../infra/supabase';
import type { InboundWhatsAppHandler, WhatsAppConnector } from './WhatsAppConnectorPort';
import { SupabaseSessionFileStore } from './SupabaseSessionFileStore';

type BaileysModule = typeof import('@whiskeysockets/baileys');

export type BaileysConnectorOptions = {
  admin: SupabaseAdminClient;
  sessionStore: SupabaseSessionFileStore;
  onMessage: InboundWhatsAppHandler;
  enabled: boolean;
};

type CompanySocket = {
  socket: Awaited<ReturnType<BaileysModule['default']>>;
  authDir: string;
};

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeRestoredFiles(authDir: string, files: Array<{ relativePath: string; body: Buffer }>) {
  await fs.mkdir(authDir, { recursive: true });
  for (const file of files) {
    const target = path.join(authDir, file.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.body);
  }
}

async function readJsonFiles(rootDir: string, currentDir = rootDir): Promise<Array<{ relativePath: string; body: Buffer }>> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: Array<{ relativePath: string; body: Buffer }> = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readJsonFiles(rootDir, fullPath));
    } else if (entry.name.endsWith('.json')) {
      files.push({
        relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
        body: await fs.readFile(fullPath),
      });
    }
  }
  return files;
}

export class BaileysConnector implements WhatsAppConnector {
  readonly kind = 'baileys' as const;
  private readonly admin: SupabaseAdminClient;
  private readonly sessionStore: SupabaseSessionFileStore;
  private readonly onMessage: InboundWhatsAppHandler;
  private readonly enabled: boolean;
  private readonly sockets = new Map<string, CompanySocket>();

  constructor(options: BaileysConnectorOptions) {
    this.admin = options.admin;
    this.sessionStore = options.sessionStore;
    this.onMessage = options.onMessage;
    this.enabled = options.enabled;
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    const { data } = await this.admin
      .from('bot_whatsapp_sessions')
      .select('company_id')
      .eq('connector', 'baileys');
    for (const row of (data ?? []) as Array<{ company_id: string }>) {
      await this.connectCompany(row.company_id);
    }
  }

  async stop(): Promise<void> {
    for (const [companyId, item] of this.sockets.entries()) {
      item.socket.end(new Error('server_stopping'));
      await fs.rm(item.authDir, { recursive: true, force: true });
      this.sockets.delete(companyId);
    }
  }

  async connectCompany(companyId: string): Promise<void> {
    if (!this.enabled) {
      await this.upsertSessionStatus(companyId, 'disconnected', 'Baileys desactivado por ENABLE_BAILEYS=false.');
      return;
    }
    if (this.sockets.has(companyId)) return;

    const baileys = await import('@whiskeysockets/baileys');
    const authDir = path.join(os.tmpdir(), 'nexus-baileys', companyId);
    const restored = await this.sessionStore.loadCompanyFiles(companyId);
    await writeRestoredFiles(authDir, restored);
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const socket = baileys.default({
      auth: {
        creds: state.creds,
        keys: baileys.makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Nexus WhatsApp Bot', 'Chrome', '1.0.0'],
    });

    this.sockets.set(companyId, { socket, authDir });
    await this.upsertSessionStatus(companyId, 'connecting', null);

    socket.ev.on('creds.update', async () => {
      await saveCreds();
      await this.persistAuthDir(companyId, authDir);
    });

    socket.ev.on('connection.update', async (update) => {
      if (update.qr) await this.upsertSessionStatus(companyId, 'qr', null, update.qr);
      if (update.connection === 'open') {
        await this.persistAuthDir(companyId, authDir);
        await this.upsertSessionStatus(companyId, 'connected', null, null, socket.user?.id ?? null);
      }
      if (update.connection === 'close') {
        this.sockets.delete(companyId);
        await this.upsertSessionStatus(companyId, 'disconnected', 'Conexion cerrada; se reintentara al despertar.');
        setTimeout(() => {
          void this.connectCompany(companyId);
        }, 5000);
      }
    });

    socket.ev.on('messages.upsert', async (event) => {
      for (const message of event.messages) {
        const fromMe = Boolean(message.key.fromMe);
        const jid = message.key.remoteJid;
        const text = message.message?.conversation
          ?? message.message?.extendedTextMessage?.text
          ?? '';
        if (fromMe || !jid || !text) continue;
        const phone = jid.replace(/@s\.whatsapp\.net$/, '');
        const answer = await this.onMessage({
          companyId,
          phone,
          text,
          messageId: message.key.id ?? undefined,
        });
        await this.sendMessage(companyId, phone, answer);
      }
    });
  }

  async disconnectCompany(companyId: string): Promise<void> {
    const item = this.sockets.get(companyId);
    if (item) {
      item.socket.end(new Error('company_disconnected'));
      await fs.rm(item.authDir, { recursive: true, force: true });
      this.sockets.delete(companyId);
    }
    await this.upsertSessionStatus(companyId, 'disconnected', null);
  }

  async sendMessage(companyId: string, phone: string, text: string): Promise<void> {
    const item = this.sockets.get(companyId);
    if (!item) throw new Error('whatsapp_session_not_connected');
    const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    await item.socket.sendMessage(jid, { text });
  }

  private async persistAuthDir(companyId: string, authDir: string) {
    if (!await fileExists(authDir)) return;
    const files = await readJsonFiles(authDir);
    for (const file of files) {
      await this.sessionStore.saveFile(companyId, file.relativePath, file.body);
    }
  }

  private async upsertSessionStatus(
    companyId: string,
    status: 'disconnected' | 'qr' | 'connecting' | 'connected' | 'error',
    lastError: string | null,
    qr: string | null = null,
    phoneNumber: string | null = null,
  ) {
    await this.admin.from('bot_whatsapp_sessions').upsert({
      company_id: companyId,
      connector: 'baileys',
      status,
      last_error: lastError,
      last_qr: qr,
      phone_number: phoneNumber,
      session_storage_prefix: this.sessionStore.prefixForCompany(companyId),
      last_seen_at: new Date().toISOString(),
      connected_at: status === 'connected' ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,connector' });
  }
}
