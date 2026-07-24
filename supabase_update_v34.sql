-- DON ZOILO V34.0 — BALANCE DIARIO
-- Crea una tabla nueva. No elimina ni modifica datos existentes.
create table if not exists public.daily_balances (
  id text primary key,
  balance_date date not null unique,
  current_assets numeric not null default 0,
  client_accounts numeric not null default 0,
  stock_value numeric not null default 0,
  total_assets numeric not null default 0,
  supplier_debt numeric not null default 0,
  total_liabilities numeric not null default 0,
  daily_expenses numeric not null default 0,
  previous_equity numeric not null default 0,
  final_equity numeric not null default 0,
  result_before_expenses numeric not null default 0,
  net_result numeric not null default 0,
  variation_pct numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.daily_balances enable row level security;
drop policy if exists "daily_balances_select_anon" on public.daily_balances;
drop policy if exists "daily_balances_insert_anon" on public.daily_balances;
drop policy if exists "daily_balances_update_anon" on public.daily_balances;
drop policy if exists "daily_balances_delete_anon" on public.daily_balances;
create policy "daily_balances_select_anon" on public.daily_balances for select to anon using (true);
create policy "daily_balances_insert_anon" on public.daily_balances for insert to anon with check (true);
create policy "daily_balances_update_anon" on public.daily_balances for update to anon using (true) with check (true);
create policy "daily_balances_delete_anon" on public.daily_balances for delete to anon using (true);
grant select,insert,update,delete on public.daily_balances to anon;
