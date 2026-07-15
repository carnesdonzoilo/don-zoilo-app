
-- V28: fotos digitales de remitos firmados

create table if not exists public.signed_receipts (
  id text primary key,
  batch_id text not null,
  client text,
  delivery_date date,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz default now()
);

create index if not exists signed_receipts_batch_id_idx
on public.signed_receipts(batch_id);

alter table public.signed_receipts enable row level security;

drop policy if exists "leer remitos firmados" on public.signed_receipts;
drop policy if exists "crear remitos firmados" on public.signed_receipts;
drop policy if exists "eliminar remitos firmados" on public.signed_receipts;

create policy "leer remitos firmados"
on public.signed_receipts for select
to anon
using (true);

create policy "crear remitos firmados"
on public.signed_receipts for insert
to anon
with check (true);

create policy "eliminar remitos firmados"
on public.signed_receipts for delete
to anon
using (true);

insert into storage.buckets (id, name, public)
values ('signed-remitos','signed-remitos',true)
on conflict (id) do update set public=true;

drop policy if exists "ver fotos remitos firmados" on storage.objects;
drop policy if exists "subir fotos remitos firmados" on storage.objects;
drop policy if exists "eliminar fotos remitos firmados" on storage.objects;

create policy "ver fotos remitos firmados"
on storage.objects for select
to anon
using (bucket_id='signed-remitos');

create policy "subir fotos remitos firmados"
on storage.objects for insert
to anon
with check (bucket_id='signed-remitos');

create policy "eliminar fotos remitos firmados"
on storage.objects for delete
to anon
using (bucket_id='signed-remitos');
