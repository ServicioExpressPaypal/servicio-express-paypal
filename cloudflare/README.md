# Infraestructura de prueba de Saldo Express

Los identificadores de `staging-resources.json` corresponden a recursos reales
creados en Cloudflare para este proyecto. No son credenciales. No reutilizar
recursos de otros proyectos de la cuenta.

## Estado

- D1: `saldo-express-staging`, con migraciones de autenticacion y negocio aplicadas.
- R2: `saldo-express-kyc-staging`, privado, sin dominio publico.
- Worker `saldo-express-portal` desplegado en https://portal.saldoexpressnicaragua.com.
- El nuevo portal esta conectado a D1 y R2. La demo original permanece separada.
- El correo administrador esta configurado como secreto del Worker; no se publica
  en el frontend. El acceso exige contrasena y un PIN administrativo temporal
  (`ADMIN_SECOND_FACTOR=pin`) con autorizacion de 15 minutos. El PIN no sustituye
  un segundo factor independiente; el modo TOTP permanece listo para activarse.
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

## Operacion

1. Mantener Resend como proveedor de correo. Cloudflare Email Sending no se utiliza.
2. Revisar aviso de privacidad y terminos cuando cambie el flujo o la retencion.
3. Mantener Turnstile, limites de intentos y el factor administrativo activos.
4. Ejecutar pruebas, migraciones y verificacion remota antes de cada despliegue.

El registro publico esta habilitado. No se aceptan documentos de identidad; los
datos temporales de cada ticket se eliminan conforme a la retencion documentada.
Ver `portal/README.md` para pruebas y puesta en marcha.

El alta privada del administrador se realiza mediante invitacion de un solo uso
al correo configurado. El alta inicial ya se cerro tras crear la cuenta. El
aviso legal no se sirve desde esta carpeta; las versiones publicas viven en la
raiz y se copian al portal durante el build.
