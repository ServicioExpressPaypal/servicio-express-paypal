# Portal de solicitudes y factura personalizada

Fecha: 23 de septiembre de 2026. Alcance: propuesta implementada como prototipo local navegable; integraciones externas investigadas, pendientes de conectar.

Actualizacion: el prototipo incluye ahora registro simulado, KYC con ambas caras
de cedula y activacion manual. Para el alcance vigente de registro y privacidad,
ver [Registro y KYC](registro-kyc-2026-09-23.md). La propuesta previa de verificacion
telefonica no forma parte del nuevo registro solicitado; no hay Auth real conectado.

## Resultado propuesto

El cliente informa monto, modalidad, banco y moneda una sola vez. El sistema genera un ticket y el operador recibe un aviso. En su panel, el operador consulta los datos, revisa disponibilidad y registra una cotizacion. Se prepara una factura individual cuando corresponde. El operador decide cuando emitirla y compartirla. El ticket es una solicitud, no una confirmacion de disponibilidad, un pago o una reserva de fondos.

La pagina debe mostrar si se reciben solicitudes Express e Internacionales; estas banderas no prometen existencia de saldo. La reserva de liquidez, si se incorpora mas adelante, necesita un proceso separado.

## Canal de avisos recomendado

| Canal | Papel | Requisitos / estado |
| --- | --- | --- |
| Panel | Bandeja permanente y estado de solicitudes | Recomendado como registro principal |
| Correo del equipo | Aviso con ID de ticket y enlace al panel | Configurar remitente verificado y destinatario |
| WhatsApp manual | Contacto desde el panel tras revision | Numero y consentimiento de contacto; validar admisibilidad del servicio |
| WhatsApp Cloud API | Avisos automaticos a un numero autorizado | Meta Business, numero remitente, credenciales, consentimiento y plantillas aprobadas; sujeto a politicas |

No hay ventaja suficiente para hacer depender la primera version de WhatsApp Cloud API. El panel y correo cubren el aviso interno. El enlace al chat solo prepararia el mensaje; no significa que se haya enviado ni entregado.

Meta exige consentimiento para contactar y, en su plataforma, una plantilla aprobada para iniciar conversaciones o escribir fuera de las 24 horas posteriores al ultimo mensaje del usuario. Un formulario web por si solo no abre esa ventana. Ademas, su politica incluye restricciones para facilitar intercambios de moneda real o virtual. No se ha confirmado elegibilidad de este negocio: el boton manual tampoco constituye una excepcion. [Politica oficial de WhatsApp Business](https://business.whatsapp.com/policy).

## Automatizacion con PayPal

La herramienta adecuada es Invoicing API v2, con una cuenta PayPal Business que tenga facturacion habilitada. Las credenciales pertenecen al servidor y no deben introducirse en el frontend ni compartirse por chat. No se ha accedido a la cuenta para comprobar su habilitacion. [Requisitos y flujo oficial](https://developer.paypal.com/api/invoicing/).

1. El operador acepta la solicitud y fija el importe exacto a cobrar. Se guarda una version inmutable de la cotizacion.
2. El backend crea un borrador con `POST /v2/invoicing/invoices`. Personaliza destinatario, concepto real, moneda, importe y referencia del ticket.
3. Guarda el identificador devuelto por PayPal. El borrador no se envia al cliente automaticamente.
4. Tras la revision, `POST /v2/invoicing/invoices/{invoice_id}/send` lo emite. Con `send_to_recipient: true`, PayPal notifica al correo del cliente; con `false`, se emite sin ese correo para compartir el enlace manualmente. Debe usarse fecha de emision actual; una fecha futura cambia el comportamiento a envio programado.
5. Se conserva el enlace devuelto por PayPal, sin inventarlo a partir del ID. Se asocia al mismo ticket.

Fuentes: [crear borrador](https://developer.paypal.com/api/invoicing/v2/invoices-create), [emitir y elegir envio por correo o enlace](https://developer.paypal.com/api/invoicing/v2/invoices-send).

La personalizacion esta en los datos de la factura: nombre y correo, referencia, concepto e importe. No debe prometerse control total del asunto o cuerpo del correo generado por PayPal. La API de envio documenta que ignora algunos textos de notificacion personalizados. El enlace de pago generico actual no permite por si solo la misma conciliacion individual.

No sumar la comision por segunda vez: si el cliente declara que enviara USD 164, el total de cobro de la factura debe reflejar exactamente el importe aprobado. El monto que recibira localmente y los costos descontados se conservan en la cotizacion. No confundir el total recibido con el ingreso del negocio.

### Confirmacion del pago

`INVOICING.INVOICE.PAID` no basta para marcar el ticket como pagado: PayPal indica que el evento tambien puede dispararse con un pago parcial o pendiente. El backend debe verificar la firma, consultar el recurso por API y revisar importe, moneda, receptor y evidencia de pago real. Una factura marcada manualmente como pagada fuera de PayPal no prueba que PayPal recibio dinero. [Eventos oficiales de facturacion](https://developer.paypal.com/platforms/invoicing/reference/invoicing-webhooks/).

La futura implementacion necesita un registro unico por ID de evento, transiciones atomicas, recuperacion de timeouts y conciliacion de facturas existentes antes de repetir creaciones. El reloj comienza con la confirmacion completa y la liberacion operativa; no por una captura, el regreso del navegador o el mero envio de la factura. Un pago confirmado tampoco elimina el riesgo de disputa, reversion o retencion.

## Restriccion concreta del modelo

La politica de PayPal incluye negocios de cambio de moneda entre actividades prohibidas (apartado 3.g) y servicios de facilitacion de pagos entre los que exigen aprobacion previa. No debe interpretarse que esa aprobacion concede automaticamente una excepcion a una prohibicion. La facturacion documenta el concepto real y no habilita por si misma el negocio. [Politica de PayPal aplicable a cuentas de EE. UU.](https://www.paypal.com/us/legalhub/paypal/acceptableuse-full).

El portal de solicitudes puede desarrollarse por separado, pero trasladar cobro y deposito a WhatsApp no convierte automaticamente el servicio global en no regulado. El encuadre debe evaluarse sobre el flujo completo y la entidad que opera. La documentacion anterior sobre BCN sigue siendo una referencia de investigacion, no una clasificacion legal definitiva.

## Infraestructura para la version conectada

Recomendacion actualizada: Cloudflare Workers con Static Assets para el portal y su API, Supabase Auth para usuarios y Supabase PostgreSQL para registros. D1 es una opcion SQL con semantica SQLite; no es intrinsecamente inseguro, pero conservar Postgres permite reutilizar la base existente y sus politicas RLS. Cloudflare DNS puede incorporarse sin transferir el dominio al registrador de Cloudflare. Son operaciones distintas.

El registro real necesita verificacion de correo, un proveedor de OTP para telefono, recuperacion de cuenta, sesiones y MFA para administradores. Guardar un telefono o pedir que el usuario lo declare correcto no verifica su titularidad. En el piloto local estos controles no estan implementados; todos los perfiles son ficticios.

Esquema propuesto:

| Entidad | Datos principales |
| --- | --- |
| Perfiles | ID de Auth, nombre, correo y telefono confirmados |
| Solicitudes | ID interno UUID, referencia publica, propietario, monto decimal, modalidad, banco, moneda, estado |
| Consentimientos | Version, finalidad, instante y evidencia de aceptacion |
| Cotizaciones | Version, costos, neto, tasa, vigencia, plazo y operador |
| Eventos | Actor, transicion, fecha; notas internas fuera de la vista del cliente |
| Facturas | Referencia a ticket/cotizacion, ID PayPal, importe, estado y enlace |
| Buzon de salida | Aviso pendiente, intentos, proximo reintento y resultado |
| Eventos PayPal | ID unico, verificacion, fecha y resultado de procesamiento |

La creacion del ticket y su aviso pendiente deben ser una sola transaccion. Un fallo del correo no borra el ticket ni genera duplicados. La lista del panel sigue siendo el registro principal. RLS impide que un usuario vea tickets ajenos; el cliente no modifica roles, cotizaciones ni estados operativos.

No es necesario pedir cedula ni numero de cuenta para demostrar este recorrido. Si se incorporan a produccion, requieren un formulario y almacenamiento especificos, acceso restringido y politica de privacidad/retencion. No enviarlos por notificaciones.

## Prototipo entregado y limites

Ruta: `_pilot/tickets/index.html`, abrir directamente en un navegador. No requiere servidor ni acceso a cuentas.

Incluye:

- bandeja, busqueda, filtros, detalle e historial;
- vista del cliente de ejemplo, formulario y sus tickets;
- controles de disponibilidad para cada modalidad;
- cotizacion con neto calculado, costos, tasa, vigencia y plazo;
- borrador personalizado de factura y JSON de referencia;
- borrador de mensaje y notificaciones simuladas;
- cierre/cancelacion con historial;
- datos exclusivamente en memoria: recargar restablece la demostracion.

No implementa registro/autenticacion real, Postgres, email/SMS, envio de WhatsApp, acceso a PayPal, webhooks, confirmacion de pagos ni desembolsos. No ha sido publicado. El selector entre cliente y administrador existe solo para revisar el prototipo, y no es un control de autorizacion utilizable en produccion.

Para conectar la version real hacen falta el correo destinatario del equipo, el proyecto Supabase elegido, un proveedor de email/OTP y la cuenta Cloudflare. Para facturas reales tambien se necesita revisar la actividad admitida de la cuenta PayPal y configurar sus credenciales mediante secretos del servidor. La integracion se prueba primero con cuentas y facturas Sandbox.

## Verificacion

- `node --test _pilot/tickets/domain.test.cjs`: montos, transiciones, cotizacion, factura y expiracion.
- `_pilot/tickets/browser.test.cjs`: flujo cliente/operador, filtros, cotizacion, factura, cierre, disponibilidad, aislamiento de texto y vistas a 390, 768 y 1440 pixeles. Requiere Playwright y Chrome.
- El navegador no debe hacer peticiones HTTP externas al usar el prototipo.
