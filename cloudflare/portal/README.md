# Portal Saldo Express

Produccion: https://portal.saldoexpressnicaragua.com. La home de GitHub Pages
permanece en construccion; el Worker y su base D1 se despliegan por separado.

## Registro y permisos

- Correo y contrasena, aceptacion versionada, verificacion de correo y aprobacion
  manual. El perfil no recibe nombre, cedula, fotografias, telefono ni banco.
- Better Auth guarda un hash de la contrasena y sesiones HttpOnly/Secure. La
  cuenta queda pendiente desde su alta; solo una cuenta activa puede crear tickets.
- ADMIN_EMAIL define el unico administrador. ADMIN_SETUP_OPEN debe permanecer
  false. ADMIN_REQUIRE_MFA=false conserva la decision del propietario de no
  exigir doble factor; esto deja un riesgo adicional ante robo de contrasena.
- REGISTRATION_OPEN y KYC_OPEN controlan registro y aceptacion del perfil.
  KYC_OPEN es un nombre heredado: este flujo no certifica identidad ni KYC legal.
- El administrador puede activar, pedir correccion, suspender y cerrar con motivo
  y aviso por correo. Cerrar una cuenta no borra automaticamente el historial.

## Proteccion contra abuso

- Cloudflare protege el dominio frente a DDoS. Bot Fight Mode esta activo en la
  zona. No hay garantia de disponibilidad ilimitada ni de ausencia de ataques.
- Turnstile administrado en registro, acceso, recuperacion y reenvio. El Worker
  valida token, hostname y action antes de ejecutar autenticacion. Tokens de un
  solo uso, expirados o invalidos se rechazan; fallos del proveedor no habilitan
  un bypass. TURNSTILE_ENABLED=false solo se permite en hosts locales/de pruebas.
- Tres intentos de registro por IP o tres intentos de autenticacion fallidos
  activan un bloqueo temporal de 15 minutos. Recuperacion y reenvio tambien
  consumen intentos para limitar envio abusivo de correo. Un acceso correcto
  limpia fallos de acceso, pero no el contador independiente de registros.
- D1 reserva cada intento atomicamente antes del hash de contrasena. Usa HMAC de
  CF-Connecting-IP, no X-Forwarded-For; la limpieza elimina contadores vencidos.
- API_LIMITER limita 60 solicitudes/minuto/IP por ubicacion Cloudflare antes de
  consultar D1. Es aproximado y distribuido; no sustituye proteccion DDoS.
- Limites adicionales por usuario, payload de 16 KiB, origen estricto, CSP,
  permisos en servidor, idempotencia y control de versiones en escrituras.
- Las IP compartidas pueden bloquear a varios usuarios. Resend y Workers tienen
  cuotas: vigilar errores y consumo; no se ha contratado ningun plan en este cambio.

## Datos y retencion

- Cada ticket dura 24 horas. Nombre del beneficiario, banco, cuenta y comentarios
  son temporales. Las consultas ocultan estos datos al vencer, cerrar o cancelar.
- retention.ts elimina esos campos y mensajes de la base activa cada 15 minutos
  y antes de consultar tickets; cerrar/cancelar tambien ejecuta la limpieza.
- Conserva ticket, usuario, montos, estimacion/cotizacion, moneda, fechas, estado,
  eventos sin contenido del chat y version/fecha de condiciones aceptadas.
- D1 Time Travel puede conservar versiones previas hasta 30 dias segun plan.
  Restaurar con el portal cerrado y limpiar antes de reabrir. El borrado activo
  no elimina inmediatamente respaldos.
- R2 permanece privado por compatibilidad, no recibe nuevos documentos. Antes
  de abrir se verifico que produccion solo tenia la cuenta administradora,
  sin expedientes ni tickets de clientes.
- No guardar datos bancarios/personales en motivos administrativos, registros de
  consola, correos o WhatsApp automatico. No registrar cuerpos ni tokens.
- /privacidad.html y /terminos.html se copian desde la raiz al build. Conservar
  versiones aceptadas en Git, identificadas por certificate.js. Responsable:
  SoftOhm Systems LLC, info@softohmsystems.com. Los textos no certifican
  cumplimiento ni autorizacion de actividad financiera.

## Comunicaciones

Resend envia verificacion, recuperacion y decisiones. Remitente:
cuentas@saldoexpressnicaragua.com. RESEND_API_KEY tiene permiso de envio y se
guarda como secreto, al igual que TURNSTILE_SECRET, BETTER_AUTH_SECRET y
ADMIN_EMAIL. Nunca imprimirlos ni guardarlos en Git.

WHATSAPP_PROVIDER=disabled: el cliente usa el enlace oficial y confirma su envio.
La automatizacion Meta requiere plantilla aprobada y secretos WHATSAPP_ACCESS_TOKEN,
WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ADMIN_NUMBER; no activar sin probarla. No hay
facturacion PayPal, pagos ni transferencias automaticas en el portal.

## Pruebas y despliegue

Node 24 o posterior, desde esta carpeta:

```sh
npm ci
npm run check
npm test
npx wrangler d1 migrations list saldo-express-staging --remote
npx wrangler d1 migrations apply saldo-express-staging --remote
npm run deploy
```

Tests con workerd/D1/R2 efimeros y proveedores simulados: registro, verificacion,
hash, consentimiento, permisos, activacion, MFA opcional, destinos, chat, borrado
al vencer/cancelar, Turnstile y bloqueo IP concurrente. No envian mensajes reales.
Avisos legales: `node --test ../../legal.test.cjs`.

`npm run preview` es una demo aislada en 127.0.0.1:8792 con cliente@example.test,
pendiente@example.test y admin@example.test, clave ficticia SoloPruebas-2026!.
Nunca publicar estas cuentas ni usar secretos reales en la demo. Para wrangler
dev, usar .dev.vars ignorado por Git con APP_URL local, TURNSTILE_ENABLED=false
y secretos exclusivos de desarrollo.

Mantener REGISTRATION_OPEN=false hasta verificar migraciones, secretos,
Turnstile y avisos en produccion; entonces abrir y comprobar /api/config.
No regenerar BETTER_AUTH_SECRET al desplegar: invalidaria sesiones y MFA.

Limitacion conocida: listas limitadas a los 100 registros mas recientes. Agregar
paginacion antes de superar esa cantidad. No sustituir la cuenta administradora
ni sembrar credenciales de prueba en produccion.
