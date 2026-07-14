
create table if not exists public.product_prices (
  product_key text primary key,
  product_name text not null,
  last_price numeric not null default 0,
  updated_at timestamptz default now()
);

alter table public.product_prices enable row level security;

drop policy if exists "leer precios" on public.product_prices;
drop policy if exists "crear precios" on public.product_prices;
drop policy if exists "actualizar precios" on public.product_prices;

create policy "leer precios"
on public.product_prices for select
to anon
using (true);

create policy "crear precios"
on public.product_prices for insert
to anon
with check (true);

create policy "actualizar precios"
on public.product_prices for update
to anon
using (true)
with check (true);
