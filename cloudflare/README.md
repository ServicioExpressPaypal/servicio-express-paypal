# Infraestructura de prueba de Saldo Express

Los identificadores de `staging-resources.json` corresponden a recursos reales
creados en Cloudflare para este proyecto. No son credenciales. No reutilizar
recursos de otros proyectos de la cuenta.

## Estado

- D1: `saldo-express-staging`, con migraciones de autenticacion y negocio aplicadas.
- R2: `saldo-express-kyc-staging`, privado, sin dominio publico.
- Worker `saldo-express-portal` desplegado en https://portal.saldoexpressnicaragua.com.
- El nuevo portal esta conectado a D1 y R2. La demo original permanece separada.
- No hay cuentas reales, contrasenas, documentos ni tickets almacenados.
- El correo administrador esta configurado como secreto del Worker; no se publica
  en el frontend. Su cuenta aun no ha sido creada ni verificada.
- GitHub Pages sigue alojando la pagina; el dominio mantiene su registrador.
- La zona `saldoexpressnicaragua.com` esta creada en Cloudflare (plan gratuito),
  activa. Los cuatro registros A de GitHub Pages y el CNAME
  de `www` estan copiados con proxy desactivado.
- `dns-migration.json` registra el inventario completo de Northwest y los servidores
  asignados. No hay registros de correo ni otros servicios en ese inventario.
  El propietario guardo los servidores de Cloudflare en Northwest. Verificado en
  el panel, el registro padre .com y el resolvedor 1.1.1.1. Pagina y piloto devuelven
  HTTPS 200; www redirige correctamente. Cloudflare confirmo activacion.

## Antes de recibir datos

1. Resolver el envio de correo: la consulta a Email Sending fue rechazada con
   `Unauthorized` (2036). Esto no permite afirmar que el servicio este activado.
2. Completar aviso de privacidad y terminos, conservacion/eliminacion y respaldos.
3. Crear y verificar cuenta del administrador y configurar su autenticador.
4. Comprobar el flujo con correo real antes de abrir registro y documentos.

Registro y documentos estan deshabilitados en el servidor. No enviar documentos
reales a este entorno. Ver `portal/README.md` para pruebas y puesta en marcha.
