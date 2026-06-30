# Nexus WhatsApp Bot SaaS

SaaS multiempresa para responder WhatsApp con documentos propios de cada empresa.

Arquitectura:

- Backend Node persistente para Render: motor del bot, RAG, Gemini, documentos y Baileys.
- Frontend Vite/React para Netlify: panel minimo de empresa, QR, documentos y activacion.
- Supabase compartido con Nexus: `companies`, `company_members`, `ai_usage`, `company_ai_limits` y tablas nuevas `bot_*`.

## Desarrollo local

```bash
npm install
cp .env.example .env
npm run dev
```

Panel local:

```bash
npm run dev:client
```

## Verificacion

```bash
npm test
npm run build
npm run lint
```

## Migracion Supabase

Aplica:

```text
supabase/migrations/20260630210000_bot_whatsapp_rag_schema.sql
```

La migracion crea:

- `bot_whatsapp_sessions`
- `bot_documents`
- `bot_document_chunks`
- `bot_structured_answers`
- `bot_response_cache`
- `bot_messages`
- buckets privados `bot-documents` y `bot-sessions`
- funcion `bot_match_document_chunks`
