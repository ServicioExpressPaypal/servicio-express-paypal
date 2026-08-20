-- Pausa temporal del KYC público.
-- Mantiene las tablas/migración preparadas, pero impide enviar KYC o solicitudes
-- desde usuarios autenticados hasta que el dueño autorice activar el flujo.

revoke execute on function public.submit_kyc(
  text, text, text, text, text, text, text, text, boolean, boolean, boolean
) from public, anon, authenticated;

revoke execute on function public.submit_exchange_request(numeric, text, text)
from public, anon, authenticated;

revoke execute on function public.review_kyc(uuid, text, text)
from public, anon;

grant execute on function public.review_kyc(uuid, text, text)
to authenticated;
