-- DON ZOILO V33.0 — STOCK MANUAL SEGURO
-- Crea UNA tabla nueva. No modifica movements, orders, product_prices ni otras tablas existentes.

create table if not exists public.inventory_stock (
  id text primary key,
  product text not null,
  detail_status text not null default '',
  category text not null default 'Otros',
  unit text not null default 'kg',
  quantity numeric not null default 0,
  kg numeric not null default 0,
  unit_cost numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_stock_product_idx on public.inventory_stock (product);
create index if not exists inventory_stock_category_idx on public.inventory_stock (category);

alter table public.inventory_stock enable row level security;

drop policy if exists "inventory_stock_select_anon" on public.inventory_stock;
drop policy if exists "inventory_stock_insert_anon" on public.inventory_stock;
drop policy if exists "inventory_stock_update_anon" on public.inventory_stock;
drop policy if exists "inventory_stock_delete_anon" on public.inventory_stock;

create policy "inventory_stock_select_anon" on public.inventory_stock for select to anon using (true);
create policy "inventory_stock_insert_anon" on public.inventory_stock for insert to anon with check (true);
create policy "inventory_stock_update_anon" on public.inventory_stock for update to anon using (true) with check (true);
create policy "inventory_stock_delete_anon" on public.inventory_stock for delete to anon using (true);

grant select, insert, update, delete on public.inventory_stock to anon;
