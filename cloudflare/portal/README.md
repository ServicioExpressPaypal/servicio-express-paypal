# Portal con almacenamiento persistente

Worker separado de GitHub Pages: https://portal.saldoexpressnicaragua.com

## Implementado

- Better Auth 1.7.6: correo/contrasena, verificacion, recuperacion, sesiones
  HttpOnly y doble factor TOTP. No hay autenticacion propia ni selector de rol.
- D1: usuarios, sesiones, perfiles, tickets, cotizaciones, historial y avisos.
- R2 privado: acceso administrativo a archivos anteriores. El nuevo formulario
  no admite fotografias ni nuevos documentos.
- Administrador: correo configurado como secreto y cuenta verificada. Por peticion
  del propietario, `ADMIN_REQUIRE_MFA=false`: acceso con contrasena y correo
  verificado, sin exigir autenticador. El navegador no puede asignarse permisos.
  Si la variable se omite o no es `false`, se exige MFA confirmado en la sesion
  durante los ultimos 15 minutos. Revisar esta decision antes de admitir clientes.
- Revision manual del expediente. Cuenta suspendida/cerrada no crea tickets.
- Certificado de regalo en efectivo: nombre comercial con descripcion expresa
  del obsequio para un familiar o beneficiario en Nicaragua. El ticket sigue
  siendo una solicitud de cotizacion, no una compra ejecutada ni un instrumento
  de valor emitido.
- Perfil minimo actualmente revisado de forma manual. No se solicita ni admite
  numero de cedula ni fotografias nuevas.
- Cada ticket solicita nombre del beneficiario, banco, numero de cuenta y moneda,
  y guarda la version y fecha de las condiciones aceptadas. Solo el propietario
  del ticket y el administrador pueden consultar estos datos.
- Sin descripcion libre del origen de fondos; declaracion
  simple de veracidad, autorizacion del beneficiario, titularidad de su cuenta y
  procedencia licita, no declaracion notarial. Un beneficiario y una cuenta a su
  nombre por solicitud.
- Correo verificado y aprobacion administrativa obligatorios. Las correcciones
  regresan a pendiente. Los datos de destino se validan nuevamente en cada ticket.
- Calculadora compartida ejecutada tambien en el servidor; se conserva la
  estimacion original y se comprueba la coherencia de la cotizacion final.
  El servidor asigna automaticamente certificado hasta USD 500 y Metodo
  internacional desde USD 500.01; no confia en una modalidad enviada por el cliente.
  El ticket destaca el valor neto estimado y conserva monto base y costos.
- Aislamiento por propietario, validacion de origen, limites de solicitudes,
  tamano de solicitudes, idempotencia y control de versiones.
- Cambios de expediente/ticket e historial en transacciones D1.
- Cada ticket vence 24 horas despues de su creacion. La API calcula el estado
  vencido, bloquea acciones y comentarios posteriores, y conserva el expediente
  como historial.
- Conversacion persistente por ticket entre cliente y administrador. Los mensajes
  tienen limite de 1,000 caracteres, control de acceso por propietario y no se
  duplican en el detalle de auditoria. La compra y el pago se coordinan fuera del
  portal mediante WhatsApp, usando solo el ID del ticket como referencia.
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
   plazos y procedimiento de conservacion/eliminacion. `public/certificate.js`
   contiene un aviso ESPECIFICO DEL PILOTO, no una politica legal definitiva.
   Es accesible antes del registro; su version y fecha de aceptacion del perfil
   se guardan en el servidor. Completar tambien el registro de aceptaciones en
   el alta antes de abrir. Revisar actividad efectiva y condiciones de proveedores;
   llamarla certificado no cambia la operacion ni la exime de controles.
3. La cuenta del propietario ya esta creada y verificada. Se elimino su
   configuracion TOTP pendiente y el alta privada se cerro (`ADMIN_SETUP_OPEN=false`).
   No activar cuentas de clientes directamente mediante SQL.
4. Probar entrega, MFA, recuperacion, revision y tickets desde navegador con el
   proveedor real. Validar CPU de autenticacion con el plan de Workers contratado.
5. Definir respaldos/restauracion y conservacion de archivos anteriores. El nuevo
   formulario no escribe en R2 ni elimina documentos historicos. No se ha
   habilitado eliminacion automatica de expedientes sin definir plazo y fundamento.
6. Separar produccion si se desea conservar staging para pruebas. Las listas
   muestran los 100 registros mas recientes; agregar paginacion antes de superarlos.

Solo despues cambiar los controles de apertura y desplegar. No solicitar
documentos reales en el estado actual.

## Desarrollo y pruebas

### Vista local con cuentas ficticias

`npm run preview` compila y arranca en http://127.0.0.1:8792/. D1 y R2 son
efimeros; no usa secretos reales y todo correo se intercepta sin enviarlo.
Las cuentas `cliente@example.test` y `admin@example.test` usan la clave
exclusiva de prueba `SoloPruebas-2026!`; sus correos se marcan verificados
solo en esta base local. El cliente incluye un perfil activo y un ticket ficticio
con conversacion para revisar la interfaz sin introducir datos reales.
Nunca ejecutar este servidor en una interfaz publica ni introducir datos reales.
El registro, la verificacion real por correo y el cierre en produccion se prueban
por separado con `npm test`. Puede cambiarse el puerto con `PORT=8793 npm run preview`.

### Alta privada del propietario

`ADMIN_SETUP_OPEN=true` habilita la invitacion, no el registro publico. Abrir
`/?setup=1` y solicitarla: se envia exclusivamente al `ADMIN_EMAIL` del servidor.
El formulario no permite elegir destinatario ni asignar un rol. La invitacion
vence en una hora, se almacena como hash en D1 y se reclama atomicamente antes
de crear la cuenta. Solicitudes repetidas no reemplazan una invitacion vigente.
Con una cuenta del propietario existente no se envia otra invitacion ni se
permite sustituir su contrasena por este mecanismo.

El propietario debe abrir el enlace de correo, elegir personalmente su
contrasena, verificar su correo e iniciar sesion. TOTP y codigos de recuperacion
solo son obligatorios si `ADMIN_REQUIRE_MFA` no es `false`.
El administrador no necesita cargar su cedula para este alta. No introducir
contrasenas, tokens de invitacion ni secretos de autenticador en el chat.
Despues del alta, establecer `ADMIN_SETUP_OPEN=false` y desplegar.

`legal-review.md` contiene un borrador privado y los datos pendientes de los
textos legales. No se publica ni se presenta como cumplimiento juridico.

### Comandos

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
Comprueba registro, verificacion, MFA, perfil sin fotos, archivos anteriores,
activacion, tickets, cotizaciones, permisos y conflictos de version.

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
Workers por separado. La pagina principal enlaza el portal desde "Mi cuenta"
y el pie de pagina; el registro publico permanece cerrado.

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
