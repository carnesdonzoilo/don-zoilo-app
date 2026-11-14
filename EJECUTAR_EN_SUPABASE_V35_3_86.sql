-- DON ZOILO V35.3.86 - UNICO SQL A EJECUTAR
-- La tabla client_payment_terms ya fue creada en Supabase.
-- Este cambio solo habilita el plazo de 10 dias.
-- No borra ni modifica cuentas corrientes, remitos, pagos o saldos.
BEGIN;
ALTER TABLE public.client_payment_terms
  DROP CONSTRAINT IF EXISTS client_payment_terms_days_check;
ALTER TABLE public.client_payment_terms
  ADD CONSTRAINT client_payment_terms_days_check
  CHECK (days IN (0,3,7,10,14,21,30));
COMMIT;
