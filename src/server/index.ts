import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { createSupabaseAdmin } from './infra/supabase';
import { GeminiBotAi } from './ai/GeminiBotAi';
import { SupabaseBotRepository } from './bot/SupabaseBotRepository';
import { BotEngine } from './bot/BotEngine';
import { SupabaseSessionFileStore } from './connectors/SupabaseSessionFileStore';
import { SupabaseStorageDriver } from './connectors/SupabaseStorageDriver';
import { BaileysConnector } from './connectors/BaileysConnector';
import { createPanelRouter } from './panel/panelRoutes';
import { N8nNotifier } from './integrations/n8n';

const config = loadConfig();
const admin = createSupabaseAdmin(config);
const ai = new GeminiBotAi({
  apiKey: config.GEMINI_API_KEY,
  model: config.GEMINI_MODEL,
  embeddingModel: config.GEMINI_EMBEDDING_MODEL,
});
const repository = new SupabaseBotRepository(admin);
const engine = new BotEngine({ repository, ai });
const sessionStore = new SupabaseSessionFileStore(new SupabaseStorageDriver(admin));
const n8n = new N8nNotifier({
  webhookUrl: config.N8N_WEBHOOK_URL,
  webhookSecret: config.N8N_WEBHOOK_SECRET,
});
const connector = new BaileysConnector({
  admin,
  sessionStore,
  enabled: config.ENABLE_BAILEYS === 'true',
  onMessage: async (message) => {
    const { data: company } = await admin
      .from('companies')
      .select('bot_active')
      .eq('id', message.companyId)
      .maybeSingle();
    if (!company || !(company as { bot_active?: boolean }).bot_active) {
      return 'El chatbot esta desactivado temporalmente.';
    }
    const result = await engine.answerBotMessage({
      empresaId: message.companyId,
      telefonoCliente: message.phone,
      mensajeTexto: message.text,
    });
    void n8n.notifyMessage({
      companyId: message.companyId,
      phone: message.phone,
      text: message.text,
      answer: result.textoRespuesta,
      source: result.source,
      route: result.debug.route,
      cacheHit: result.debug.cacheHit,
      geminiCalled: result.debug.geminiCalled,
      createdAt: new Date().toISOString(),
    }).catch((error) => {
      console.error('[n8n] webhook notification failed', { error: error instanceof Error ? error.message : String(error) });
    });
    return result.textoRespuesta;
  },
});

const app = express();
app.use(cors({
  origin: config.PANEL_ORIGIN === '*' ? true : config.PANEL_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nexus-whatsapp-bot-saas' });
});
app.use('/api/panel', createPanelRouter({ admin, ai, engine, connector }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = [
  path.resolve(process.cwd(), 'dist/client'),
  path.resolve(process.cwd(), 'src/client'),
  path.resolve(__dirname, '../client'),
].find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientDir));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.listen(config.PORT, () => {
  console.log(`Nexus WhatsApp Bot listening on ${config.PORT}`);
  void connector.start();
});

process.on('SIGTERM', () => {
  void connector.stop().finally(() => process.exit(0));
});
