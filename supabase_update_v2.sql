
alter table public.movements add column if not exists source_order_id text;

create table if not exists public.orders (
  id text primary key,
  delivery_date date not null,
  client text not null,
  product text not null,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  total numeric not null default 0,
  payment_method text not null default 'cuenta_corriente',
  notes text,
  delivered boolean not null default false,
  delivered_at timestamptz,
  created_at timestamptz default now()
);

alter table public.orders enable row level security;

drop policy if exists "leer pedidos" on public.orders;
drop policy if exists "crear pedidos" on public.orders;
drop policy if exists "actualizar pedidos" on public.orders;
drop policy if exists "eliminar pedidos" on public.orders;

create policy "leer pedidos" on public.orders for select to anon using (true);
create policy "crear pedidos" on public.orders for insert to anon with check (true);
create policy "actualizar pedidos" on public.orders for update to anon using (true) with check (true);
create policy "eliminar pedidos" on public.orders for delete to anon using (true);
