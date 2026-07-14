-- Ejecutar en Supabase > SQL Editor

create table if not exists public.movements (
  id text primary key,
  date date not null,
  type text not null check (type in ('venta','cobro','compra','pago','gasto','ajuste')),
  party text,
  concept text not null,
  kg numeric default 0,
  amount numeric not null default 0,
  payment_method text default 'efectivo',
  status text default 'confirmado',
  notes text,
  created_at timestamptz default now()
);

alter table public.movements enable row level security;

-- MVP simple: cualquiera que tenga el link y la clave pública podrá leer y escribir.
-- Para una versión definitiva conviene agregar login.
create policy "public read movements"
on public.movements for select
to anon
using (true);

create policy "public insert movements"
on public.movements for insert
to anon
with check (true);

create policy "public delete movements"
on public.movements for delete
to anon
using (true);
