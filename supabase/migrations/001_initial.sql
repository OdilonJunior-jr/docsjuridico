create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null,
  cpf text not null,
  cpf_norm text not null,
  rg text,
  nationality text,
  marital_status text,
  profession text,
  address_line text,
  address_number text,
  neighborhood text,
  city text,
  state text,
  cep text,
  company_name text,
  cnpj text,
  company_address_line text,
  company_address_number text,
  company_neighborhood text,
  company_city text,
  company_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, cpf_norm)
);

create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('identity','residence')),
  path text not null,
  mime_type text not null,
  original_name text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, path)
);

create table if not exists public.generated_documents (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('procuracao','hipossuficiencia')),
  docx_path text not null,
  pdf_path text,
  created_at timestamptz not null default now()
);

create index if not exists clients_owner_name_idx on public.clients(owner_id, full_name);
create index if not exists clients_owner_cpf_idx on public.clients(owner_id, cpf_norm);
create index if not exists docs_owner_created_idx on public.generated_documents(owner_id, created_at desc);

alter table public.clients enable row level security;
alter table public.source_files enable row level security;
alter table public.generated_documents enable row level security;

drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own" on public.clients for select to authenticated using (owner_id = auth.uid());
drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own" on public.clients for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "source_select_own" on public.source_files;
create policy "source_select_own" on public.source_files for select to authenticated using (owner_id = auth.uid());
drop policy if exists "source_insert_own" on public.source_files;
create policy "source_insert_own" on public.source_files for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "source_update_own" on public.source_files;
create policy "source_update_own" on public.source_files for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "source_delete_own" on public.source_files;
create policy "source_delete_own" on public.source_files for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "docs_select_own" on public.generated_documents;
create policy "docs_select_own" on public.generated_documents for select to authenticated using (owner_id = auth.uid());
drop policy if exists "docs_insert_own" on public.generated_documents;
create policy "docs_insert_own" on public.generated_documents for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "docs_update_own" on public.generated_documents;
create policy "docs_update_own" on public.generated_documents for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "docs_delete_own" on public.generated_documents;
create policy "docs_delete_own" on public.generated_documents for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.source_files to authenticated;
grant select, insert, update, delete on public.generated_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-documents','source-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-documents','generated-documents',false,15728640,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false, file_size_limit=15728640;

drop policy if exists "source_storage_select_own" on storage.objects;
create policy "source_storage_select_own" on storage.objects for select to authenticated using (bucket_id='source-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "source_storage_insert_own" on storage.objects;
create policy "source_storage_insert_own" on storage.objects for insert to authenticated with check (bucket_id='source-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "source_storage_delete_own" on storage.objects;
create policy "source_storage_delete_own" on storage.objects for delete to authenticated using (bucket_id='source-documents' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "generated_storage_select_own" on storage.objects;
create policy "generated_storage_select_own" on storage.objects for select to authenticated using (bucket_id='generated-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "generated_storage_insert_own" on storage.objects;
create policy "generated_storage_insert_own" on storage.objects for insert to authenticated with check (bucket_id='generated-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "generated_storage_delete_own" on storage.objects;
create policy "generated_storage_delete_own" on storage.objects for delete to authenticated using (bucket_id='generated-documents' and (storage.foldername(name))[1]=auth.uid()::text);
