# Infraestructura de prueba de Saldo Express

Los identificadores de `staging-resources.json` corresponden a recursos reales
creados en Cloudflare para este proyecto. No son credenciales. No reutilizar
recursos de otros proyectos de la cuenta.

## Estado

- D1: `saldo-express-staging`, con migraciones de autenticacion y negocio aplicadas.
- R2: `saldo-express-kyc-staging`, privado, sin dominio publico.
- Worker `saldo-express-portal` desplegado en https://portal.saldoexpressnicaragua.com.
- El nuevo portal esta conectado a D1 y R2. La demo original permanece separada.
- Existe la cuenta verificada del propietario; no hay documentos ni tickets de clientes.
- El correo administrador esta configurado como secreto del Worker; no se publica
  en el frontend. Por peticion del propietario, el acceso no exige autenticador
  (`ADMIN_REQUIRE_MFA=false`). La configuracion TOTP pendiente fue eliminada.
- GitHub Pages sigue alojando la pagina; el dominio mantiene su registrador.
- Resend configurado: dominio verificado, clave de solo envio limitada al dominio
  guardada como secreto del Worker. Correo de verificacion real entregado a Gmail;
  la cuenta temporal de prueba fue eliminada. No se contrato un plan de pago.
- La zona `saldoexpressnicaragua.com` esta creada en Cloudflare (plan gratuito),
  activa. Los cuatro registros A de GitHub Pages y el CNAME
  de `www` estan copiados con proxy desactivado.
- `dns-migration.json` registra el inventario completo de Northwest y los servidores
  asignados. No hay registros de correo ni otros servicios en ese inventario.
  El propietario guardo los servidores de Cloudflare en Northwest. Verificado en
  el panel, el registro padre .com y el resolvedor 1.1.1.1. Pagina y piloto devuelven
  HTTPS 200; www redirige correctamente. Cloudflare confirmo activacion.

## Antes de recibir datos

1. Mantener Resend como proveedor de correo. Cloudflare Email Sending no se utiliza.
2. Completar aviso de privacidad y terminos, conservacion/eliminacion y respaldos.
3. Revisar proteccion del acceso administrativo antes de admitir documentos sensibles.
4. Comprobar el flujo con correo real antes de abrir registro y documentos.

Registro y documentos estan deshabilitados en el servidor. No enviar documentos
reales a este entorno. Ver `portal/README.md` para pruebas y puesta en marcha.

El alta privada del administrador se realiza mediante invitacion de un solo uso
al correo configurado. El alta inicial ya se cerro tras crear la cuenta. El
borrador `portal/legal-review.md` sigue pendiente de domicilio, contacto y
revision antes de abrir clientes; no se sirve desde la web.
