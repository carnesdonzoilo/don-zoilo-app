-- Ejecutar una vez en Supabase SQL Editor. Solo agrega configuraciones de plazo.
create table if not exists public.client_payment_terms (
  client_key text primary key,
  days integer not null default 7 check (days in (0,3,7,14,21,30)),
  updated_at timestamptz not null default now()
);
alter table public.client_payment_terms enable row level security;
drop policy if exists "client_payment_terms_app_access" on public.client_payment_terms;
create policy "client_payment_terms_app_access" on public.client_payment_terms
  for all to anon, authenticated using (true) with check (true);
