-- Don Zoilo v35.3.9 · Catálogo administrable de precios
-- SEGURO: no modifica pedidos, remitos, movimientos, stock ni cuentas corrientes.

alter table public.product_prices
  add column if not exists category text,
  add column if not exists is_catalog boolean not null default false,
  add column if not exists sort_order integer not null default 0;

-- Permitir eliminar productos desde el módulo Precios.
drop policy if exists "eliminar precios" on public.product_prices;
create policy "eliminar precios"
on public.product_prices for delete
to anon
using (true);

-- Marca como catálogo los productos base. Si ya existe un precio, LO CONSERVA.
insert into public.product_prices (product_key,product_name,last_price,category,is_catalog,sort_order) values
('asado banderita','Asado banderita',19000,'Vacunos',true,1),
('asado completo','Asado completo',17500,'Vacunos',true,2),
('asado costillar marcado','Asado costillar marcado',17000,'Vacunos',true,3),
('asado premium 10 costillas','Asado premium 10 costillas',24500,'Vacunos',true,4),
('bife ancho x taco','Bife ancho x taco',16500,'Vacunos',true,5),
('bife ancho','Bife ancho',17500,'Vacunos',true,6),
('bife angosto','Bife angosto',18500,'Vacunos',true,7),
('bife con lomo 10 costillas','Bife con lomo 10 costillas',17800,'Vacunos',true,8),
('bife de chorizo envasado','Bife de chorizo envasado',22500,'Vacunos',true,9),
('bife de chorizo','Bife de chorizo',24000,'Vacunos',true,10),
('bife t bone','Bife T-bone',24000,'Vacunos',true,11),
('bola de lomo envasada','Bola de lomo envasada',15500,'Vacunos',true,12),
('colita de cuadril envasada','Colita de cuadril envasada',18500,'Vacunos',true,13),
('cuadrada envasada','Cuadrada envasada',15500,'Vacunos',true,14),
('cuadril envasado','Cuadril envasado',18000,'Vacunos',true,15),
('entrana','Entraña',26000,'Vacunos',true,16),
('lomo con cordon','Lomo con cordón',26000,'Vacunos',true,17),
('matambre envasado','Matambre envasado',16000,'Vacunos',true,18),
('nalga con tapa envasada','Nalga con tapa envasada',16000,'Vacunos',true,19),
('nalga feteada envasada','Nalga feteada envasada',18000,'Vacunos',true,20),
('nalga sin tapa envasada','Nalga sin tapa envasada',17500,'Vacunos',true,21),
('nalga sin tapa fresca','Nalga sin tapa fresca',20500,'Vacunos',true,22),
('ojo de bife envasado','Ojo de bife envasado',24500,'Vacunos',true,23),
('ojo de bife','Ojo de bife',26500,'Vacunos',true,24),
('osobuco pata corta','Osobuco pata corta',12500,'Vacunos',true,25),
('paleta envasada','Paleta envasada',14000,'Vacunos',true,26),
('paleta','Paleta',16000,'Vacunos',true,27),
('peceto envasado','Peceto envasado',18500,'Vacunos',true,28),
('picada especial','Picada especial',13500,'Vacunos',true,29),
('picada oferta','Picada oferta',9500,'Vacunos',true,30),
('picana','Picaña',17000,'Vacunos',true,31),
('roastbeef envasado','Roastbeef envasado',14000,'Vacunos',true,32),
('roastbeef','Roastbeef',15500,'Vacunos',true,33),
('tapa asado envasada','Tapa asado envasada',13500,'Vacunos',true,34),
('tapa de asado','Tapa de asado',17500,'Vacunos',true,35),
('tapa de bife marucha','Tapa de bife (marucha)',14000,'Vacunos',true,36),
('tapa de nalga','Tapa de nalga',17000,'Vacunos',true,37),
('vacio envasado','Vacío envasado',19000,'Vacunos',true,38),
('vacio','Vacío',20500,'Vacunos',true,39),
('cajon de pollo','Cajón de pollo',75000,'Pollos',true,40),
('pata y muslo','Pata y muslo',4900,'Pollos',true,41),
('churrasquito de pollo','Churrasquito de pollo',8800,'Pollos',true,42),
('suprema fresca','Suprema fresca',9500,'Pollos',true,43),
('suprema x 15 kg congelada','Suprema x 15 kg congelada',7900,'Pollos',true,44),
('bondiola x caja','Bondiola x caja',8000,'Cerdo',true,45),
('bondiola','Bondiola',8800,'Cerdo',true,46),
('carre deshuesado','Carré deshuesado',10000,'Cerdo',true,47),
('carre','Carré',8200,'Cerdo',true,48),
('churrasquito de cerdo','Churrasquito de cerdo',12500,'Cerdo',true,49),
('jamon','Jamón',6500,'Cerdo',true,50),
('lechon','Lechón',15000,'Cerdo',true,51),
('matambrito','Matambrito',14500,'Cerdo',true,52),
('paleta de cerdo','Paleta de cerdo',5500,'Cerdo',true,53),
('pechito con manta','Pechito con manta',8200,'Cerdo',true,54),
('ribs paladini','Ribs Paladini',12000,'Cerdo',true,55),
('solomillo','Solomillo',10500,'Cerdo',true,56),
('chinchulin','Chinchulín',5500,'Achuras',true,57),
('lengua','Lengua',9500,'Achuras',true,58),
('molleja','Molleja',26000,'Achuras',true,59),
('mondongo','Mondongo',8500,'Achuras',true,60),
('rabo','Rabo',8500,'Achuras',true,61),
('rinon','Riñón',5500,'Achuras',true,62),
('chorizo colorado','Chorizo colorado',12500,'Embutidos',true,63),
('chorizo puro cerdo con morron','Chorizo puro cerdo con morrón',9500,'Embutidos',true,64),
('chorizo puro cerdo','Chorizo puro cerdo',7500,'Embutidos',true,65),
('chorizo vacuno','Chorizo vacuno',6500,'Embutidos',true,66),
('longaniza','Longaniza',6500,'Embutidos',true,67),
('morcilla','Morcilla',6500,'Embutidos',true,68),
('panceta','Panceta',22500,'Embutidos',true,69),
('salchicha copetin','Salchicha copetín',9800,'Embutidos',true,70),
('salchicha parrillera','Salchicha parrillera',12500,'Embutidos',true,71),
('salchicha viena','Salchicha viena',9500,'Embutidos',true,72),
('chivito','Chivito',16500,'Granja',true,73),
('cordero','Cordero',15500,'Granja',true,74),
('cochinillo','Cochinillo',17500,'Granja',true,75),
('pata de cordero','Pata de cordero',14500,'Granja',true,76),
('hamburguesas de carne','Hamburguesas de carne',13500,'Preparados',true,77),
('milanesas de carne','Milanesas de carne',13500,'Preparados',true,78),
('milanesas de pollo','Milanesas de pollo',9500,'Preparados',true,79),
('hamburguesas de pollo','Hamburguesas de pollo',13500,'Preparados',true,80)
on conflict (product_key) do update set
  product_name = excluded.product_name,
  category = excluded.category,
  is_catalog = true,
  sort_order = excluded.sort_order;

create index if not exists product_prices_catalog_idx
  on public.product_prices (is_catalog, category, sort_order);
