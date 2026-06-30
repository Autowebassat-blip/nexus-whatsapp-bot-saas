# Deployment

## Decision de persistencia Baileys

Usar Supabase Storage para las sesiones de Baileys, no disco local de Render.

Motivo: Render Free puede dormir o reiniciar el servicio y su filesystem es efimero. La documentacion de Render indica que los web services Free no pueden usar persistent disks; los discos persistentes son para servicios de pago. Por eso el conector restaura los archivos de auth desde el bucket privado `bot-sessions` al arrancar y vuelve a sincronizarlos cuando Baileys emite `creds.update`.

## Supabase

1. En el mismo proyecto Supabase de Nexus, abre SQL Editor.
2. Ejecuta `supabase/migrations/20260630210000_bot_whatsapp_rag_schema.sql`.
3. Confirma que existen los buckets privados `bot-documents` y `bot-sessions`.
4. Confirma que la extension `vector` esta habilitada.
5. Crea o reutiliza usuarios Supabase Auth para entrar al panel.

## Render

Tipo de servicio:

- New Web Service
- Runtime: Node
- Plan: Free
- Root directory: carpeta del proyecto `nexus-whatsapp-bot-saas`
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/health`

Variables de entorno en Render:

```text
NODE_ENV=production
PORT=10000
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY=TU_ANON_KEY
GEMINI_API_KEY=TU_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.0-flash-lite
GEMINI_EMBEDDING_MODEL=text-embedding-004
PANEL_ORIGIN=https://TU-PANEL.netlify.app
ENABLE_BAILEYS=true
```

Notas:

- `SUPABASE_SERVICE_ROLE_KEY` solo va en Render. Nunca en Netlify.
- Render Free puede dormir. Al despertar, `npm start` levanta el proceso, `connector.start()` lee `bot_whatsapp_sessions`, restaura auth desde `bot-sessions` y reconecta Baileys.
- Si un QR caduca, pulsa "Mostrar QR" otra vez desde el panel.

## Netlify

Tipo:

- Site from Git
- Base directory: carpeta del proyecto `nexus-whatsapp-bot-saas`
- Build command: `npm ci && npm run build`
- Publish directory: `dist/client`

Variables de entorno en Netlify:

```text
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
VITE_API_BASE_URL=https://TU-SERVICIO.onrender.com
```

Despues de obtener la URL de Netlify, vuelve a Render y actualiza:

```text
PANEL_ORIGIN=https://TU-PANEL.netlify.app
```

## Alta del piloto de tienda de motos

1. Entra al panel de Netlify.
2. Crea la empresa de la tienda.
3. Pulsa "Mostrar QR".
4. Escanea el QR con un numero secundario de WhatsApp Business.
5. Sube documentos de horarios, garantias, servicios y catalogo.
6. Pulsa "Activar".
