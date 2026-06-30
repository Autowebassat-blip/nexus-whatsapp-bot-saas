import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import type { BotEngine } from '../bot/BotEngine';
import { assertCompanyAccess, bearerToken, verifyJwt } from '../infra/auth';
import type { SupabaseAdminClient } from '../infra/supabase';
import type { BotAiPort } from '../bot/ports';
import { processCompanyDocument } from '../documents/documentService';
import type { WhatsAppConnector } from '../connectors/WhatsAppConnectorPort';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

type RouteDeps = {
  admin: SupabaseAdminClient;
  ai: BotAiPort;
  engine: BotEngine;
  connector: WhatsAppConnector;
};

async function requireAuth(req: express.Request, admin: SupabaseAdminClient) {
  const token = bearerToken(req.header('authorization'));
  if (!token) throw new Error('missing_jwt');
  return verifyJwt(admin, token);
}

function jsonError(res: express.Response, error: unknown) {
  const code = error instanceof Error ? error.message : 'unknown_error';
  const status = code === 'missing_jwt' || code === 'invalid_jwt'
    ? 401
    : code === 'company_access_denied'
      ? 403
      : 400;
  res.status(status).json({ ok: false, error: code });
}

export function createPanelRouter(deps: RouteDeps) {
  const router = express.Router();

  router.get('/companies', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      const [{ data: owned }, { data: memberships }] = await Promise.all([
        deps.admin.from('companies').select('id, name, bot_active, created_at').eq('owner_id', auth.userId),
        deps.admin.from('company_members').select('company_id').eq('user_id', auth.userId),
      ]);
      const memberIds = ((memberships ?? []) as Array<{ company_id: string }>).map((row) => row.company_id);
      const { data: memberCompanies } = memberIds.length
        ? await deps.admin.from('companies').select('id, name, bot_active, created_at').in('id', memberIds)
        : { data: [] };
      const companies = [...(owned ?? []), ...(memberCompanies ?? [])]
        .filter((company, index, all) => all.findIndex((candidate) => candidate.id === company.id) === index);
      const companyIds = companies.map((company) => (company as { id: string }).id);
      const { data: sessions } = companyIds.length
        ? await deps.admin.from('bot_whatsapp_sessions').select('company_id, status, last_qr, updated_at').in('company_id', companyIds)
        : { data: [] };
      res.json({
        ok: true,
        companies: companies.map((company) => {
          const typedCompany = company as { id: string; name: string; bot_active?: boolean };
          const session = ((sessions ?? []) as Array<{ company_id: string; status: string; last_qr?: string | null; updated_at?: string }>)
            .find((candidate) => candidate.company_id === typedCompany.id);
          return {
            id: typedCompany.id,
            name: typedCompany.name,
            botActive: Boolean(typedCompany.bot_active),
            whatsappStatus: session?.status ?? 'disconnected',
            lastQr: session?.last_qr ?? null,
            updatedAt: session?.updated_at,
          };
        }),
      });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.post('/companies', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      const name = String((req.body as { name?: unknown }).name ?? '').trim();
      if (!name) throw new Error('missing_company_name');
      const { data, error } = await deps.admin
        .from('companies')
        .insert({ owner_id: auth.userId, name })
        .select('id, name, bot_active')
        .single();
      if (error) throw new Error(error.message);
      res.status(201).json({ ok: true, company: data });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.post('/companies/:companyId/connect-whatsapp', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      await assertCompanyAccess(deps.admin, auth.userId, req.params.companyId, true);
      await deps.connector.connectCompany(req.params.companyId);
      res.json({ ok: true });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.get('/companies/:companyId/whatsapp-status', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      await assertCompanyAccess(deps.admin, auth.userId, req.params.companyId);
      const { data } = await deps.admin
        .from('bot_whatsapp_sessions')
        .select('status, last_qr, last_error, updated_at')
        .eq('company_id', req.params.companyId)
        .eq('connector', 'baileys')
        .maybeSingle();
      const qr = (data as { last_qr?: string | null } | null)?.last_qr;
      res.json({
        ok: true,
        status: data ?? { status: 'disconnected' },
        qrImage: qr ? await QRCode.toDataURL(qr) : null,
      });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.post('/companies/:companyId/activation', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      await assertCompanyAccess(deps.admin, auth.userId, req.params.companyId, true);
      const active = Boolean((req.body as { active?: unknown }).active);
      await deps.admin.from('companies').update({ bot_active: active }).eq('id', req.params.companyId);
      if (active) await deps.connector.connectCompany(req.params.companyId);
      else await deps.connector.disconnectCompany(req.params.companyId);
      res.json({ ok: true, active });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.post('/companies/:companyId/documents', upload.single('file'), async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      const companyId = String(req.params.companyId);
      await assertCompanyAccess(deps.admin, auth.userId, companyId, true);
      if (!req.file) throw new Error('missing_file');
      const result = await processCompanyDocument(deps.admin, deps.ai, {
        companyId,
        userId: auth.userId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      jsonError(res, error);
    }
  });

  router.post('/simulate/whatsapp-message', async (req, res) => {
    try {
      const auth = await requireAuth(req, deps.admin);
      const companyId = String((req.body as { companyId?: unknown }).companyId ?? '');
      await assertCompanyAccess(deps.admin, auth.userId, companyId);
      const result = await deps.engine.answerBotMessage({
        empresaId: companyId,
        telefonoCliente: String((req.body as { phone?: unknown }).phone ?? '+34000000000'),
        mensajeTexto: String((req.body as { text?: unknown }).text ?? ''),
      });
      res.json({ ok: true, result });
    } catch (error) {
      jsonError(res, error);
    }
  });

  return router;
}
