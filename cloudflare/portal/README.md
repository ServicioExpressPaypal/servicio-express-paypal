# Portal Saldo Express

Produccion: https://portal.saldoexpressnicaragua.com. La home de GitHub Pages
presenta el producto y enlaza a este portal. El Worker y su base D1 se despliegan
por separado.

## Registro y permisos

- Correo y contrasena, nombre completo, telefono, aceptacion versionada,
  verificacion de correo y aprobacion manual. Sin cedula, fotografias ni banco
  en el perfil.
- Better Auth guarda un hash de la contrasena y sesiones HttpOnly/Secure. La
  cuenta queda pendiente desde su alta; solo una cuenta activa puede crear tickets.
- ADMIN_EMAIL define el unico administrador. ADMIN_SETUP_OPEN debe permanecer
  false. ADMIN_REQUIRE_MFA=true exige TOTP o codigo de recuperacion de un solo
  uso para abrir el panel (hoy esta en false de forma temporal: el panel abre solo
  con contrasena; las cuentas con TOTP ya activado siguen pidiendolo hasta
  desactivarlo en la base de datos). La autorizacion administrativa vence en 15 minutos.
  El QR se genera localmente, sin enviar su secreto a otro proveedor.
- REGISTRATION_OPEN y KYC_OPEN controlan registro y aceptacion del perfil.
  KYC_OPEN es un nombre heredado: este flujo no certifica identidad ni KYC legal.
- El registro publico del portal esta habilitado tras verificar el doble factor
  del administrador. Los clientes nuevos siguen pendientes de aprobacion manual.
  La portada del dominio principal dirige al registro y acceso del portal.
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
- Cinco intentos por cuenta/accion en 15 minutos limitan ataques distribuidos
  entre IP distintas. Un bloqueo no extiende su propio vencimiento. No se
  almacena el correo en estos contadores, solo un HMAC con dominio separado.
- API_LIMITER limita 60 solicitudes/minuto/IP por ubicacion Cloudflare antes de
  consultar D1. Es aproximado y distribuido; no sustituye proteccion DDoS.
- Limites adicionales por usuario, payload de 16 KiB, origen estricto, CSP,
  permisos en servidor, idempotencia y control de versiones en escrituras.
- Las IP compartidas pueden bloquear a varios usuarios. Resend y Workers tienen
  cuotas: vigilar errores y consumo; no se ha contratado ningun plan en este cambio.

## Datos y retencion

- Registro v6: nombre completo en profiles.full_name; telefono internacional y
  declaracion de titularidad de PayPal en profiles.dossier. No se pide correo
  PayPal separado, documentos ni datos bancarios de perfil. La declaracion no
  es verificacion. Revision manual: hasta 2 dias habiles, lunes a viernes, tras
  correo verificado y formulario completo; sin activacion automatica ni reloj
  horario (no se ha configurado apertura/cierre). Se conservan mientras exista
  la cuenta y se eliminan con ella, tambien si se rechaza o suspende.
- Turnos: los tickets sin pago (no cancelados, cerrados ni vencidos) forman una cola
  por orden de creacion. El primero tiene una ventana de `TURN_WINDOW_SECONDS`
  (120) para que se confirme su pago; si vence y hay otros esperando, pasa al
  final. Pagar, cancelar o vencer saca el ticket de la cola. Solo entran los
  tickets creados despues de aceptar esta version de las condiciones; la
  migracion deja los tickets existentes fuera de la cola. La logica es
  idempotente (`src/queue.ts`): corre en cada cambio, al leer un ticket, en la
  alarma del Durable Object del ticket en turno y en el cron. El administrador
  nunca queda restringido por los turnos. Requiere la migracion 0014.
- AES-256-GCM cifra nombre, telefono, beneficiario, cuenta bancaria y mensajes.
- El chat del ticket es en tiempo real: `GET /api/(admin/)tickets/:id/live` abre un
  WebSocket (mismo origen, sesion y dueno del ticket o admin) hacia un Durable
  Object `TicketRoom` por ticket. El Worker guarda el mensaje cifrado y luego lo
  retransmite; el Durable Object no guarda nada. Cada conexion vence a los 10
  minutos y el navegador se reconecta (reautenticando).
  Cada valor tiene IV aleatorio y AAD ligado a fila/campo. DATA_ENCRYPTION_KEY
  esta en Worker Secrets, no en D1. El correo de autenticacion no se cifra a
  nivel de campo. Ver SECURITY.md para migracion, respaldo y recuperacion.
- Eventos de seguridad con identificador HMAC se conservan 30 dias, incluso
  tras eliminar una cuenta. Las metricas omiten cuerpos, URLs y parametros SQL.
  El cron evalua umbrales cada 15 minutos y envia alertas agregadas por Resend.

- El cliente activo ve certificados con montos base de USD 50, 100, 200, 300,
  400 y 500, junto con su neto y costos estimados por la calculadora compartida.
  Elegir uno precarga el mismo formulario que Ticket personalizado; no crea ni
  paga un ticket. El monto sigue siendo editable y se valida en el servidor.

- Express dura 24 horas desde la creacion. Internacional dura 6 dias habiles
  desde la creacion; confirmar el pago vigente fija el vencimiento a 6 dias
  habiles desde esa confirmacion. Aplica a nuevas condiciones v4; tickets
  anteriores conservan la retencion aceptada, sin recuperar datos borrados.
  Nombre del beneficiario, banco, cuenta y comentarios
  son temporales. Las consultas ocultan estos datos al vencer, cerrar o cancelar.
- retention.ts elimina esos campos y mensajes de la base activa cada 15 minutos
  y antes de consultar tickets; cerrar/cancelar tambien ejecuta la limpieza.
- Conserva ticket, usuario, montos, estimacion/cotizacion, moneda, fechas, estado,
  eventos sin contenido del chat y version/fecha de condiciones aceptadas.
- D1 Time Travel puede conservar versiones previas hasta 30 dias segun plan.
  Restaurar con el portal cerrado y limpiar antes de reabrir. El borrado activo
  no elimina inmediatamente respaldos.
- R2 permanece privado por compatibilidad, no recibe nuevos documentos. Las
  descargas historicas requieren administrador autorizado, se sirven como
  adjuntos y llevan CSP sandbox, nunca HTML inline.
- No guardar datos bancarios/personales en motivos administrativos, registros de
  consola, correos o WhatsApp automatico. No registrar cuerpos ni tokens.
- /privacidad.html y /terminos.html se copian desde la raiz al build. Conservar
  versiones aceptadas en Git, identificadas por certificate.js. Responsable:
  SoftOhm Systems LLC, soportesaldoexpress@gmail.com. Los textos no certifican
  cumplimiento ni autorizacion de actividad financiera.

## Comunicaciones

Resend envia verificacion, recuperacion y decisiones. Remitente:
cuentas@saldoexpressnicaragua.com. RESEND_API_KEY tiene permiso de envio y se
guarda como secreto, al igual que TURNSTILE_SECRET, BETTER_AUTH_SECRET y
ADMIN_EMAIL y DATA_ENCRYPTION_KEY. Nunca imprimirlos ni guardarlos en Git.

WHATSAPP_PROVIDER=disabled: el cliente usa el enlace oficial y confirma su envio.
El administrador tambien puede compartir un resumen sin datos de destino desde
el detalle del ticket. El enlace incluye la referencia y exige autenticacion;
no concede acceso por si mismo ni envia mensajes automaticamente.

Los tickets mayores de USD 500 tienen seguimiento estimado de 2 a 6 dias
habiles, iniciado unicamente por un administrador al confirmar el pago de un
ticket vigente, sin emitir una segunda cotizacion. Se cuentan lunes a viernes en America/Managua, sin
ajuste por feriados. El administrador confirma la entrega por separado. Las
fechas quedan en el historial. Internacional v4 conserva datos de destino
hasta su nuevo vencimiento o cierre/cancelacion, lo que ocurra primero.
El vencimiento no equivale a entrega ni elimina una obligacion pagada.
Aplicar 0009_ticket_processing.sql antes de
desplegar. El contador no puede reiniciarse desde la API.
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
hash, consentimiento, permisos, activacion, MFA obligatorio, destinos, chat,
borrado al vencer/cancelar, cifrado, migracion, Turnstile, bloqueo IP concurrente
y por cuenta. No envian mensajes reales.
Avisos legales: `node --test ../../legal.test.cjs`.

`npm run preview` es una demo aislada en 127.0.0.1:8792 con cliente@example.test,
pendiente@example.test y admin@example.test, clave ficticia SoloPruebas-2026!.
Nunca publicar estas cuentas ni usar secretos reales en la demo. Para wrangler
dev, usar .dev.vars ignorado por Git con APP_URL local, TURNSTILE_ENABLED=false
y secretos exclusivos de desarrollo.

Mantener REGISTRATION_OPEN=false hasta verificar migraciones, secretos,
Turnstile, avisos y MFA del propietario en produccion; entonces abrir y comprobar
/api/config. El cierre del registro no interrumpe cuentas existentes.
No regenerar BETTER_AUTH_SECRET al desplegar: invalidaria sesiones y MFA.

Limitacion conocida: listas limitadas a los 100 registros mas recientes. Agregar
paginacion antes de superar esa cantidad. No sustituir la cuenta administradora
ni sembrar credenciales de prueba en produccion.
