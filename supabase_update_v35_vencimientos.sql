-- DON ZOILO V35.0 — AGENDA DE VENCIMIENTOS
-- Agrega una tabla nueva. No borra ni modifica datos existentes.

create table if not exists public.due_dates (
  id text primary key,
  title text not null,
  due_date date not null,
  amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','paid')),
  remind_days integer not null default 3 check (remind_days >= 0 and remind_days <= 365),
  category text not null default 'General',
  notes text not null default '',
  source_text text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists due_dates_due_date_idx on public.due_dates(due_date);
create index if not exists due_dates_status_idx on public.due_dates(status);

alter table public.due_dates enable row level security;

drop policy if exists "due_dates_select_anon" on public.due_dates;
drop policy if exists "due_dates_insert_anon" on public.due_dates;
drop policy if exists "due_dates_update_anon" on public.due_dates;
drop policy if exists "due_dates_delete_anon" on public.due_dates;

create policy "due_dates_select_anon" on public.due_dates for select to anon using (true);
create policy "due_dates_insert_anon" on public.due_dates for insert to anon with check (true);
create policy "due_dates_update_anon" on public.due_dates for update to anon using (true) with check (true);
create policy "due_dates_delete_anon" on public.due_dates for delete to anon using (true);

grant select,insert,update,delete on public.due_dates to anon;
