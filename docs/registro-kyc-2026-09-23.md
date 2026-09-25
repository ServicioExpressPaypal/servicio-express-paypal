# Registro y revision manual: prototipo

Actualizacion de alcance acordada el 23 de septiembre de 2026.
Esta especificacion reemplaza, para registro y KYC, la propuesta inicial del piloto.
No se ha desplegado ni conectado a cuentas reales.

## Interfaz

- Cliente: Mi cuenta y Mis solicitudes. Registro por correo y contrasena, correo
  verificado, datos de identidad y estado de revision. Sin metricas administrativas.
- Administrador: Solicitudes y Usuarios. Expediente con ambas imagenes ampliables,
  declaracion, consentimientos y eventos. Acciones: activar, pedir correccion,
  suspender, reactivar y cerrar. Motivo obligatorio; activar exige confirmar revision.
- Disponibilidad y avisos quedan como controles secundarios.
- Se mantiene el flujo previo de tickets, cotizacion y borrador local de factura.

## Estados

`unverified -> incomplete -> pending -> active`

- Verificar correo NO activa la cuenta.
- `pending -> correction -> pending`: solicita correccion y nueva aceptacion.
- `active -> suspended -> active`: suspension y reactivacion manual con motivo.
- `pending/correction/active/suspended -> closed`: cierre logico irreversible en
  esta demo; conserva expediente e historial hasta reiniciar.
- Solo `active` permite nuevos tickets. Se bloquean nuevas cotizaciones y vistas
  previas de factura para tickets del registro suspendido o cerrado.
- Los tickets usan referencia al propietario, no coincidencia de correo.

El navegador no implementa autorizacion real. El servidor debe repetir TODOS los
controles; ocultar botones, JavaScript o el selector de demo no protegen expedientes.

## Datos solicitados

Correo; nombre completo; numero de cedula nicaraguense; frente y reverso; categoria
y descripcion del origen de fondos. JPG o PNG de hasta 5 MB por lado. Se comprueba
que el navegador pueda decodificar las imagenes. El numero solo valida formato,
no existencia, vigencia, pertenencia ni autenticidad.

Tres aceptaciones separadas, nunca preseleccionadas: declaracion, terminos y
privacidad. Se registra texto de declaracion, version e instante. El texto canonico
esta en `_pilot/tickets/accounts.js`; version `borrador-2026-09-23`.

El registro de esta version NO pide ni verifica telefono. Si se incorpora WhatsApp,
habra que definir captura, verificacion y consentimiento correspondientes por separado.
No se implemento almacenamiento real ni se habilito el registro de Supabase.

## Terminos: alcance del borrador

Se contempla suspension o cierre por incumplimiento, informacion falsa, riesgo de
seguridad o requerimiento legal, con proporcionalidad, notificacion y revision
cuando proceda. Cerrar no significa confiscar fondos ni borrar obligaciones o
expedientes sujetos a conservacion legal. No se presume un plazo de retencion.

La declaracion propuesta es una manifestacion electronica bajo responsabilidad:
no se presenta como un acta notarial ni como una declaracion jurada que cumpla
por si sola todas las formalidades aplicables. Debe revisarse juridicamente.
Este KYC no constituye licencia, autorizacion AML ni permiso del proveedor de pago.

Antes de datos reales: completar responsable legal, domicilio, contacto de
privacidad y reclamacion, finalidades, bases aplicables, destinatarios/proveedores,
paises de tratamiento, retencion y derechos. Revisar proporcionalidad de recopilar
ambas caras, obligaciones aplicables al negocio y mecanismos internacionales.

Referencia primaria consultada: [Ley 787, Ley de Proteccion de Datos Personales](https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=E5D37E9B4827FC06062579ED0076CE1D).
Sus articulos 3, 5 y 6 contemplan consentimiento informado y datos proporcionales
a la finalidad. Esta referencia no es un dictamen de vigencia ni una revision
exhaustiva del marco aplicable; requiere validacion profesional local.

## Pendiente para produccion

1. Auth real con verificacion de correo por token de un uso, expiracion, recuperacion,
   sesiones seguras, limitacion de intentos y MFA obligatorio para operadores.
2. Postgres: perfiles vinculados al ID de Auth, expedientes versionados, consentimientos
   inmutables, tickets, decisiones y auditoria. Estado de activacion solo editable
   por operadores autorizados. RLS y comprobacion transaccional en cada solicitud.
3. Documentos en almacenamiento PRIVADO, nunca GitHub ni un bucket publico.
   Acceso temporal firmado, limites y validacion por contenido en servidor, proteccion
   contra archivos maliciosos y registro de accesos. No incluir documentos en logs.
4. Avisos sin datos sensibles: ID de expediente/ticket y enlace al panel autenticado.
   Enviar correo de verificacion y avisos de estado solo mediante backend.
5. Revisar el negocio completo, los borradores y las politicas de proveedores antes
   de habilitar operaciones. Definir retencion, eliminacion y respuesta a incidentes.
6. Retirar selector de roles y datos de ejemplo al construir la version real.
   Probar aislamiento entre usuarios, permisos de operadores y restauracion de backups.

## Verificacion local

Pruebas unitarias de estados, consentimiento, documentos, suspension y cierre.
Pruebas de navegador: registro, imagen invalida, lectura de terminos, correccion,
aprobacion, ticket, cotizacion, factura local, suspension, reactivacion y cierre.
Anchos revisados: 360, 390, 768 y 1440 px. Cero solicitudes de red externas.
