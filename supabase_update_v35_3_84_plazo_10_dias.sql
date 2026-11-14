-- Ejecutar una vez en Supabase SQL Editor. No modifica plazos existentes ni movimientos.
ALTER TABLE public.client_payment_terms
  DROP CONSTRAINT IF EXISTS client_payment_terms_days_check;
ALTER TABLE public.client_payment_terms
  ADD CONSTRAINT client_payment_terms_days_check
  CHECK (days IN (0,3,7,10,14,21,30));
