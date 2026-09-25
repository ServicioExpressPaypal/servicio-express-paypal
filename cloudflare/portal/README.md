# Portal con almacenamiento persistente

Worker separado de GitHub Pages: https://portal.saldoexpressnicaragua.com

## Implementado

- Better Auth 1.7.6: correo/contrasena, verificacion, recuperacion, sesiones
  HttpOnly y doble factor TOTP. No hay autenticacion propia ni selector de rol.
- D1: usuarios, sesiones, perfiles, tickets, cotizaciones, historial y avisos.
- R2 privado: documentos accesibles solo al administrador con doble factor
  confirmado en esa sesion durante los ultimos 15 minutos.
- Administrador: correo configurado como secreto, verificacion y MFA. El
  navegador no puede asignarse permisos. Su cuenta aun no esta creada.
- Revision manual del expediente. Cuenta suspendida/cerrada no crea tickets.
- Calculadora compartida ejecutada tambien en el servidor; se conserva la
  estimacion original y se comprueba la coherencia de la cotizacion final.
- Aislamiento por propietario, validacion de origen, limites de solicitudes,
  tamano/tipo de archivos, idempotencia y control de versiones.
- Cambios de expediente/ticket e historial en transacciones D1.
- Avisos al operador solo con ID de ticket. Reintentos cada 15 minutos, hasta
  cinco fallos. Nunca se adjuntan documentos ni datos bancarios.
- No hay pagos, facturas PayPal ni operaciones financieras automaticas.

## Cerrado por defecto

`REGISTRATION_OPEN=false`, `KYC_OPEN=false`, `EMAIL_PROVIDER=resend`.
Son controles del servidor, no restricciones cosmeticas de la interfaz.

Resend ya esta conectado al dominio verificado `saldoexpressnicaragua.com`.
Remitente: `Saldo Express <cuentas@saldoexpressnicaragua.com>`. La clave
`RESEND_API_KEY` tiene solo permiso de envio para este dominio y esta cifrada
en Cloudflare; no se guarda en Git. DKIM y los CNAME `send` y `rsend` estan
configurados en DNS, junto con DMARC en modo observacion (`p=none`).

Prueba real: `/api/auth/send-verification-email` del Worker desplegado devolvio
exito y Resend registro `Delivered` hacia Gmail. Se elimino la cuenta temporal
sin contrasena ni permisos utilizada en la prueba; no quedaron usuarios, tickets
ni registros de verificacion. Esto prueba transporte de correo, no apertura
publica, entrega siempre en bandeja principal ni el flujo completo de registro.

Antes de abrir:

1. Conservar el dominio verificado y el secreto de Resend. Vigilar cuotas y fallos
   del proveedor. Cloudflare Email Sending no se utiliza ni se contrato para esto.
2. Completar responsable, domicilio, contacto, derechos, tratamiento internacional,
   plazos y procedimiento de conservacion/eliminacion. Los textos importados de
   `accounts.js` siguen siendo BORRADORES de demo: sustituir y versionar antes
   de habilitar documentos reales. Revisar adecuacion de la actividad efectiva
   y condiciones de proveedores; un ticket no cambia esa actividad.
3. Crear y verificar la cuenta del propietario, configurar autenticador y guardar
   codigos de recuperacion. No activar cuentas directamente mediante SQL.
4. Probar entrega, MFA, recuperacion, revision y tickets desde navegador con el
   proveedor real. Validar CPU de autenticacion con el plan de Workers contratado.
5. Definir respaldos/restauracion y limpieza de documentos huerfanos ante una caida
   entre R2 y D1. Una correccion reemplaza imagenes anteriores; confirmar esa
   politica antes de produccion. No se ha habilitado eliminacion automatica de
   expedientes sin definir su plazo y fundamento.
6. Separar produccion si se desea conservar staging para pruebas. Las listas
   muestran los 100 registros mas recientes; agregar paginacion antes de superarlos.

Solo despues cambiar los controles de apertura y desplegar. No solicitar
documentos reales en el estado actual.

## Desarrollo y pruebas

Node 24 o posterior. Desde esta carpeta:

```sh
npm ci
npm run build
npx wrangler types --strict-vars false
npm run check
npm test
npx wrangler d1 migrations apply saldo-express-staging --local
npm run dev
```

Configurar `.dev.vars` local, ignorado por Git, con `APP_URL=http://localhost:8791`,
un secreto local propio de al menos 32 caracteres y administrador de prueba.
Nunca usar secretos ni documentos reales en pruebas locales.
`npm test` usa workerd con D1/R2 locales y correo interceptado, sin mensajes reales.
Comprueba registro, verificacion, MFA, documentos, activacion, tickets,
cotizaciones, permisos y conflictos de version.

## Despliegue

```sh
npx wrangler d1 migrations list saldo-express-staging --remote
npx wrangler d1 migrations apply saldo-express-staging --remote
npm run deploy
```

Secretos `BETTER_AUTH_SECRET`, `ADMIN_EMAIL` y `RESEND_API_KEY` configurados en Cloudflare.
No regenerar el secreto al desplegar: invalidaria sesiones y secretos MFA cifrados.
`wrangler secret bulk` admite JSON por stdin sin incluirlo en Git.
La migracion inicial de Better Auth se genera con `node scripts/generate-auth.mjs`
contra SQLite vacio. No sobrescribir migraciones ya aplicadas.

GitHub Pages publica solo archivos autorizados, nunca esta carpeta. Desplegar
Workers por separado. La pagina principal no enlaza aun el portal cerrado.

`/api/health` comprueba D1 sin exponer datos. Las rutas privadas devuelven 401
sin sesion; registro devuelve 503 mientras esta cerrado. No hay descarga publica
R2 ni simulacion de permisos. No se registran cuerpos de solicitudes ni tokens.

Referencias:
https://better-auth.com/docs/authentication/email-password
https://better-auth.com/docs/plugins/2fa
https://developers.cloudflare.com/workers/static-assets/
https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
https://resend.com/docs/dashboard/domains/introduction
https://resend.com/docs/dashboard/api-keys/introduction
