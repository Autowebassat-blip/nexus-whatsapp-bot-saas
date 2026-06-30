# Despliegue real y checklist de verificacion

## Estado de acceso desde Codex

No hay variables de entorno cargadas para Supabase, Render, Gemini ni Render API en esta sesion. Netlify CLI si reconoce una cuenta iniciada, pero el sitio no esta enlazado y faltan las variables reales de Supabase/Gemini/Render, asi que no he creado un despliegue funcional desde aqui.

No aplicar la migracion a Supabase real hasta confirmar el `project_ref` correcto del proyecto Nexus y tener una forma segura de usar el access token o ejecutar SQL en el dashboard.

## Preflight Supabase

Antes de ejecutar la migracion, confirma que el proyecto real de Nexus tiene estas tablas/columnas:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('companies', 'company_members', 'ai_usage');

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'companies'
  and column_name in ('id', 'name', 'owner_id', 'bot_active');

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'company_members'
  and column_name in ('company_id', 'user_id', 'role');
```

Si `owner_id` no existe en `companies`, no ejecutes todavia la migracion: hay que adaptar el panel para crear/listar empresas solo con `company_members`.

## Aplicar migracion Supabase

Opcion dashboard:

1. Abre Supabase.
2. Entra al proyecto real de Nexus.
3. Abre SQL Editor.
4. Crea una query nueva.
5. Pega el contenido completo de `supabase/migrations/20260630210000_bot_whatsapp_rag_schema.sql`.
6. Ejecuta la query.
7. Verifica:

```sql
select to_regclass('public.bot_whatsapp_sessions') as bot_whatsapp_sessions,
       to_regclass('public.bot_documents') as bot_documents,
       to_regclass('public.bot_document_chunks') as bot_document_chunks,
       to_regclass('public.bot_response_cache') as bot_response_cache,
       to_regclass('public.bot_messages') as bot_messages;

select id, name, public
from storage.buckets
where id in ('bot-documents', 'bot-sessions');

select extname
from pg_extension
where extname = 'vector';
```

Opcion CLI, solo tras confirmar el proyecto:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

## Render

Crear servicio:

1. Abre Render Dashboard.
2. New > Web Service.
3. Conecta el repo Git que contenga este proyecto.
4. Si esta dentro de un monorepo, pon Root Directory: `outputs/nexus-whatsapp-bot-saas`. Si subes esta carpeta como repo propio, deja Root Directory vacio.
5. Runtime: Node.
6. Plan: Free.
7. Build Command: `npm ci && npm run build`.
8. Start Command: `npm start`.
9. Health Check Path: `/health`.
10. Crea el servicio.

Variables de entorno en Render, dentro de Environment:

```text
NODE_ENV=production
PORT=10000
ENABLE_BAILEYS=true
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY=TU_ANON_KEY
GEMINI_API_KEY=TU_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.0-flash-lite
GEMINI_EMBEDDING_MODEL=text-embedding-004
PANEL_ORIGIN=https://TU-SITIO.netlify.app
```

`SUPABASE_SERVICE_ROLE_KEY` solo va en Render. No la pongas en Netlify.

Persistencia Baileys: usar Supabase Storage, no disco de Render. En Render Free el proceso puede dormir o reiniciarse y el filesystem local no es una fuente fiable de verdad. El conector guarda la sesion en el bucket privado `bot-sessions` y al arrancar restaura `baileys/{companyId}/...`.

## Netlify

Crear sitio:

1. Abre Netlify Dashboard.
2. Add new site > Import an existing project.
3. Elige el mismo repo Git.
4. Si esta dentro de un monorepo, Base directory: `outputs/nexus-whatsapp-bot-saas`. Si es repo propio, dejalo vacio.
5. Build command: `npm ci && npm run build`.
6. Publish directory: `dist/client`.
7. Variables de entorno:

```text
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
VITE_API_BASE_URL=https://TU-SERVICIO.onrender.com
```

8. Deploy.
9. Copia la URL de Netlify.
10. Vuelve a Render y actualiza `PANEL_ORIGIN` con esa URL exacta.
11. Redeploy Render.

## Documento de prueba

Sube `docs/catalogo-motos-piloto.txt` desde el panel. Empresa recomendada: `Moto Norte Piloto`.

## Checklist WhatsApp

1. En Netlify, inicia sesion con Supabase Auth.
2. Crea empresa `Moto Norte Piloto`.
3. Pulsa Conectar WhatsApp.
4. Escanea el QR con un numero secundario de WhatsApp Business.
5. Sube `docs/catalogo-motos-piloto.txt`.
6. Espera a que el documento quede procesado.
7. Activa el bot.

Preguntas exactas:

```text
Cuanto cuesta la revision basica de una Yamaha MT-07?
```

Resultado esperado: menciona 89 EUR y que incluye diagnostico inicial, presion de neumaticos y revision de frenos.

```text
Que garantia tiene el casco AGV K6 S?
```

Resultado esperado: menciona garantia de 24 meses con factura.

```text
Cuanto cuesta el neumatico trasero Pirelli Diablo Rosso IV?
```

Resultado esperado: menciona 179 EUR para 180/55 ZR17.

```text
Venden chaquetas de cuero Dainese?
```

Resultado esperado: indica que no consta en la documentacion disponible y recomienda contactar con la tienda.

Repite exactamente la primera pregunta:

```text
Cuanto cuesta la revision basica de una Yamaha MT-07?
```

Resultado esperado: misma respuesta o equivalente, pero servida desde cache.

## Consultas de evidencia Supabase

Sustituye `<COMPANY_ID>` por el id de `Moto Norte Piloto`.

Encontrar la empresa:

```sql
select id, name, bot_active
from companies
where name = 'Moto Norte Piloto';
```

Confirmar documento y chunks:

```sql
select id, name, status, chunk_count, error, created_at
from bot_documents
where company_id = '<COMPANY_ID>'
order by created_at desc;

select document_id, chunk_index, left(content, 180) as chunk_preview
from bot_document_chunks
where company_id = '<COMPANY_ID>'
order by document_id, chunk_index
limit 10;
```

Ver ruta usada por cada mensaje:

```sql
select created_at, incoming_text, response_text, route
from bot_messages
where company_id = '<COMPANY_ID>'
order by created_at desc
limit 20;
```

Interpretacion de `route`:

- Primera pregunta basada en documentos: debe incluir `documents` y `gemini`.
- Pregunta repetida: debe ser `cache` y no debe crear una nueva fila en `ai_usage`.
- Si insertas un dato en `bot_structured_answers`, la primera respuesta debe incluir `database`.

Ver llamadas reales a Gemini:

```sql
select created_at, request_type, provider, model, approx_tokens, metadata
from ai_usage
where company_id = '<COMPANY_ID>'
order by created_at desc
limit 20;
```

Ver cache:

```sql
select normalized_question, source, left(answer, 180) as answer_preview, created_at, expires_at
from bot_response_cache
where company_id = '<COMPANY_ID>'
order by created_at desc;
```

Prueba de BD antes de documentos/Gemini:

```sql
insert into bot_structured_answers (company_id, match_text, answer)
values ('<COMPANY_ID>', 'telefono de recambios', 'El telefono de recambios es 928 123 456.')
on conflict (company_id, match_text)
do update set answer = excluded.answer, updated_at = now();
```

Pregunta por WhatsApp:

```text
Cual es el telefono de recambios?
```

Resultado esperado: `bot_messages.route` contiene `database` y no aparece una nueva fila de `ai_usage`.

## Prueba de aislamiento entre empresas

1. Crea otra empresa: `Moto Sur Piloto`.
2. Sube a esa empresa un TXT distinto con este contenido:

```text
Catalogo interno de Moto Sur Piloto
La revision basica Yamaha MT-07 cuesta 131 EUR.
El casco AGV K6 S no se vende en esta tienda.
```

3. Conecta otro numero de WhatsApp para `Moto Sur Piloto`, o usa el endpoint de simulacion con un JWT de usuario miembro de ambas empresas.
4. Pregunta a cada empresa:

```text
Cuanto cuesta la revision basica de una Yamaha MT-07?
```

Resultado esperado:

- Moto Norte Piloto: 89 EUR.
- Moto Sur Piloto: 131 EUR.

Consulta de evidencia:

```sql
select company_id, incoming_text, response_text, route, created_at
from bot_messages
where incoming_text ilike '%revision basica%'
order by created_at desc
limit 10;
```

La respuesta de una empresa no debe citar el precio de la otra.

## Prueba de sleep Render Free

1. Deja el servicio sin trafico HTTP y sin mensajes de WhatsApp durante al menos 20 minutos.
2. En Render, abre Logs y confirma que no hubo actividad durante ese periodo.
3. Envia por WhatsApp:

```text
Que horario tienen los sabados?
```

4. Espera la reactivacion del servicio.
5. Resultado esperado: responde 10:00 a 14:00 sin pedir QR nuevo.

Consultas:

```sql
select status, last_qr, last_error, connected_at, last_seen_at, updated_at
from bot_whatsapp_sessions
where company_id = '<COMPANY_ID>'
  and connector = 'baileys';

select name, bucket_id, created_at, updated_at
from storage.objects
where bucket_id = 'bot-sessions'
  and name like 'baileys/<COMPANY_ID>/%'
order by updated_at desc
limit 20;

select created_at, incoming_text, response_text, route
from bot_messages
where company_id = '<COMPANY_ID>'
  and incoming_text ilike '%sabados%'
order by created_at desc
limit 5;
```

Evidencia esperada:

- `bot-sessions` contiene archivos de sesion para la empresa.
- `bot_whatsapp_sessions.status` vuelve a `connected` o permanece `connected`.
- No aparece un QR nuevo que tengas que escanear.
- El mensaje posterior al sleep queda registrado en `bot_messages`.
