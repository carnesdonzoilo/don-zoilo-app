
alter table public.orders add column if not exists batch_id text;
alter table public.orders add column if not exists unit text default 'kg';
