create extension if not exists "pgcrypto";
create extension if not exists vector with schema extensions;
create schema if not exists private;

insert into storage.buckets (id, name, public)
values
  ('bot-documents', 'bot-documents', false),
  ('bot-sessions', 'bot-sessions', false)
on conflict (id) do nothing;

alter table companies
  add column if not exists bot_active boolean not null default false;

create table if not exists bot_whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  connector text not null default 'baileys' check (connector in ('baileys', 'whatsapp-cloud')),
  phone_number text,
  status text not null default 'disconnected' check (status in ('disconnected', 'qr', 'connecting', 'connected', 'error')),
  session_storage_prefix text not null,
  last_qr text,
  last_error text,
  connected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connector)
);

create table if not exists bot_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  mime_type text not null,
  bucket_id text not null default 'bot-documents',
  storage_path text not null,
  size_bytes bigint not null default 0,
  content_hash text not null,
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  chunk_count integer not null default 0,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, content_hash),
  unique (bucket_id, storage_path)
);

create table if not exists bot_document_chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references bot_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_estimate integer not null default 0,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists bot_structured_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  match_text text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, match_text)
);

create table if not exists bot_response_cache (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  normalized_question text not null,
  answer text not null,
  source text not null check (source in ('database', 'documents')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  unique (company_id, normalized_question)
);

create table if not exists bot_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_phone text not null,
  incoming_text text not null,
  response_text text not null,
  route text[] not null default '{}',
  connector text not null default 'baileys',
  connector_message_id text,
  created_at timestamptz not null default now()
);

alter table bot_whatsapp_sessions enable row level security;
alter table bot_documents enable row level security;
alter table bot_document_chunks enable row level security;
alter table bot_structured_answers enable row level security;
alter table bot_response_cache enable row level security;
alter table bot_messages enable row level security;

grant select, insert, update, delete on
  bot_whatsapp_sessions,
  bot_documents,
  bot_document_chunks,
  bot_structured_answers,
  bot_response_cache,
  bot_messages
to authenticated;

create or replace function private.is_company_member(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from companies
    where id = target_company_id and owner_id = (select auth.uid())
  )
  or exists (
    select 1 from company_members
    where company_id = target_company_id and user_id = (select auth.uid())
  );
$$;

create or replace function private.is_company_admin(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from companies
    where id = target_company_id and owner_id = (select auth.uid())
  )
  or exists (
    select 1 from company_members
    where company_id = target_company_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'bot_whatsapp_sessions',
    'bot_documents',
    'bot_document_chunks',
    'bot_structured_answers',
    'bot_response_cache',
    'bot_messages'
  ]
  loop
    execute format('drop policy if exists "bot tenant read" on %I', table_name);
    execute format('drop policy if exists "bot tenant admin write" on %I', table_name);
    execute format('create policy "bot tenant read" on %I for select to authenticated using (private.is_company_member(company_id))', table_name);
    execute format('create policy "bot tenant admin write" on %I for all to authenticated using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id))', table_name);
  end loop;
end $$;

drop policy if exists "bot document object read" on storage.objects;
drop policy if exists "bot document object write" on storage.objects;
create policy "bot document object read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bot-documents'
    and private.is_company_member(((storage.foldername(name))[1])::uuid)
  );
create policy "bot document object write"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'bot-documents'
    and private.is_company_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'bot-documents'
    and private.is_company_admin(((storage.foldername(name))[1])::uuid)
  );

create index if not exists bot_sessions_company_idx on bot_whatsapp_sessions(company_id);
create index if not exists bot_documents_company_status_idx on bot_documents(company_id, status);
create index if not exists bot_chunks_company_document_idx on bot_document_chunks(company_id, document_id);
create index if not exists bot_cache_company_question_idx on bot_response_cache(company_id, normalized_question);
create index if not exists bot_messages_company_created_idx on bot_messages(company_id, created_at desc);
create index if not exists bot_chunks_embedding_hnsw_idx
  on bot_document_chunks
  using hnsw (embedding vector_cosine_ops);

create or replace function bot_match_document_chunks (
  query_embedding extensions.vector(768),
  match_company_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  company_id uuid,
  document_id uuid,
  document_name text,
  chunk_index int,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    bot_document_chunks.id,
    bot_document_chunks.company_id,
    bot_document_chunks.document_id,
    bot_documents.name as document_name,
    bot_document_chunks.chunk_index,
    bot_document_chunks.content,
    1 - (bot_document_chunks.embedding <=> query_embedding) as similarity
  from bot_document_chunks
  join bot_documents on bot_documents.id = bot_document_chunks.document_id
  where bot_document_chunks.company_id = match_company_id
    and bot_documents.status = 'ready'
    and 1 - (bot_document_chunks.embedding <=> query_embedding) >= match_threshold
  order by bot_document_chunks.embedding <=> query_embedding asc
  limit least(match_count, 20);
$$;

grant execute on function bot_match_document_chunks(extensions.vector(768), uuid, float, int) to authenticated;
