# Saldo Express: textos para revision antes de abrir clientes

Estado: BORRADOR NO PUBLICADO. No constituye dictamen juridico ni confirma
autorizacion para operar servicios financieros. Version de trabajo: 2026-09-26.
Este archivo no se incluye en los archivos publicos del portal.

## Cambio de producto solicitado el 26 de septiembre

Nombre comercial solicitado: Certificado de regalo en efectivo. El portal debe
explicar que se solicita un deposito bancario financiado mediante PayPal y que
crear el ticket no ejecuta una compra ni emite un saldo o certificado canjeable.
Este nombre no es una exencion regulatoria ni evidencia de autorizacion de PayPal.
No se copian limites, comisiones ni plazos de otro comercio como supuesta garantia
de cumplimiento. Las estimaciones actuales no se han cambiado.

Diseno del perfil actualizado por instruccion del propietario: nombre, banco,
cuenta, moneda y telefono. Sin numero de cedula, fotografias ni texto libre del
origen de fondos. Solo titularidad propia.
Se conserva una declaracion simple, no jurada/notarial. Antes de abrir deben
validarse necesidad de cada campo, metodo de verificacion, requisitos de debida
diligencia y licencias que correspondan. No se presenta el formulario como KYC
legalmente suficiente. El alta y la recepcion de datos siguen cerradas.

El aviso del piloto se sirve desde public/certificate.js y ya no utiliza el
aviso de demostracion que afirmaba que los datos no salian del navegador.
El resto de este archivo es material de revision, no texto listo para publicar.

## Datos y decisiones pendientes

- Responsable confirmado por el propietario: SoftOhm Systems LLC.
- Domicilio del responsable: PENDIENTE DE CONFIRMACION.
- Correo publico para privacidad y reclamaciones: PENDIENTE DE CONFIRMACION.
- Representacion/localizacion efectiva de la operacion en Nicaragua: por revisar.
- Necesidad, proporcionalidad y fundamento de recoger fotos de cedula y origen
  de fondos: por validar antes de habilitar KYC. No asumir que sean obligatorias
  solo por crear un ticket ni que llamarlo asesoria elimine obligaciones.
- Plazos de conservacion por categoria y excepciones legales: por aprobar e
  implementar. No hay eliminacion programada de cuentas o expedientes.
- Transferencias internacionales y condiciones contractuales con encargados:
  confirmar garantias y base aplicable antes de recoger documentos.

## Propuesta de aviso de privacidad

### Responsable y contacto

SoftOhm Systems LLC es responsable del tratamiento de datos del portal Saldo
Express. Su domicilio y canal de privacidad se publicaran en esta seccion antes
de admitir clientes. No usar el correo remitente automatico como canal de
reclamaciones hasta comprobar que recibe y se atienden mensajes.

### Que datos se tratan y para que

Para mantener una cuenta se utilizan el correo, nombre, hash de la contrasena,
estado de verificacion, sesiones y datos de seguridad. El acceso administrativo
usa correo verificado y contrasena; no exige doble factor por decision del
propietario. Las contrasenas no se guardan en texto legible.

Cuando se habiliten solicitudes de clientes, se registraran importe, modalidad,
moneda, banco seleccionado, estimacion, estado y comunicaciones de cada ticket.
Se utilizaran para responder solicitudes, emitir cotizaciones, atender consultas
y mantener trazabilidad de las decisiones. Una estimacion no ejecuta un pago.

La carga de documentos permanece deshabilitada. Si se habilita posteriormente,
un aviso previo indicara los datos estrictamente necesarios, su finalidad,
fundamento, plazo y consecuencias de no proporcionarlos. No se pediran claves
de PayPal, banca en linea, PIN de tarjeta ni codigos de autenticacion externos.

### Proveedores y transferencias

El portal usa Cloudflare Workers, D1 y R2 para procesamiento y almacenamiento.
Resend envia mensajes de cuenta y avisos transaccionales y recibe las direcciones
destinatarias y el contenido de esos correos. Los avisos de tickets al operador
contienen el identificador del ticket, sin cedulas, fotos ni datos bancarios.
El administrador consulta expedientes dentro del portal con permisos restringidos.

Estos servicios pueden procesar datos fuera de Nicaragua. No se promete que toda
la informacion permanezca en Nicaragua ni que este cifrada de extremo a extremo.
Antes del lanzamiento se concretaran los destinos, encargados, garantias y bases
de las transferencias que correspondan. La pagina informativa principal usa
GitHub Pages. WhatsApp y PayPal son servicios externos con condiciones propias;
actualmente no existe envio automatico de expedientes a esas plataformas.

### Seguridad y cookies

Se utilizan conexiones HTTPS, sesiones con cookies de seguridad, controles de
acceso y registros de acciones sobre expedientes. Revisar las medidas de acceso
antes de habilitar documentos: actualmente no es obligatorio el doble factor.
El portal no incorpora publicidad ni seguimiento comercial propio. Los controles
reducen riesgos, pero no equivalen a una garantia absoluta de seguridad.

### Conservacion y ejercicio de derechos

La politica definitiva especificara plazos diferenciados para cuentas, tickets,
expedientes y registros de seguridad, asi como tratamiento de respaldos y
excepciones por obligaciones o reclamaciones. Suspender una cuenta no borra
automaticamente todos sus datos ni permite conservarlos sin limite justificado.

El titular podra solicitar informacion sobre el tratamiento y ejercer los
derechos que resulten aplicables, incluyendo acceso, rectificacion, cancelacion
u oposicion, mediante el canal de privacidad confirmado. Se comprobara su
identidad de forma proporcionada y se explicaran las limitaciones legales.
El plazo de respuesta se fijara conforme al marco aplicable; no se inventa aqui
un plazo legal ni se exige enviar de entrada otra foto de cedula por correo.

### Cambios y aceptacion

La version final mostrara fecha, version y contacto. Los cambios de finalidad o
tratamientos que lo requieran se informaran antes de su aplicacion y se recabara
la autorizacion correspondiente. La aceptacion no autoriza usos indefinidos,
publicidad ni cesiones ajenas a lo informado. El usuario podra consultar los
textos antes de crear cuenta o remitir documentos.

## Propuesta de terminos de uso

1. El portal permite gestionar solicitudes y cotizaciones de Saldo Express. No
   mantiene una billetera ni ejecuta pagos automaticamente. Las actuaciones
   externas deben describirse de acuerdo con su naturaleza real; no se facturara
   como asesoria una operacion distinta ni se garantiza exencion regulatoria.
2. Crear un ticket no garantiza disponibilidad de saldo, aceptacion, plazo,
   cotizacion definitiva o deposito. Antes de cualquier operacion se comunicaran
   importe, moneda, comisiones propias y de terceros, vigencia, tiempos estimados
   y condiciones de cancelacion. El cliente debera aceptar las condiciones
   especificas sin renunciar a los derechos irrenunciables que le correspondan.
3. El usuario debe proporcionar informacion veraz, utilizar cuentas propias o
   acreditar representacion legitima, proteger su acceso y avisar de incidentes.
   Quedan prohibidos fraude, suplantacion, documentos falsos, uso de fondos de
   origen ilicito, abuso tecnico y elusion de controles o condiciones de proveedores.
4. SoftOhm Systems LLC podra limitar, suspender o cerrar el acceso ante un
   incumplimiento comprobado, riesgo de seguridad o requerimiento legal.
   Documentara la razon y comunicara las medidas cuando legalmente proceda,
   ofreciendo un canal de revision. No se presume culpabilidad por una alerta.
   El cierre no autoriza apropiarse de fondos ni extingue obligaciones pendientes.
5. Las verificaciones no equivalen a una certificacion estatal ni a una
   autorizacion de PayPal, Wise, Payoneer, bancos o autoridades. El portal no
   afirma estar afiliado a esas entidades.
6. Las reclamaciones se atenderan mediante el contacto confirmado. No se
   establece aqui una renuncia general de responsabilidad ni un fuero extranjero
   obligatorio. La normativa aplicable y resolucion de controversias requieren
   revision antes de la publicacion.

## Propuesta de declaracion, solo si se justifica su necesidad

Declaro que la informacion que proporciono es verdadera y que puedo acreditar
la titularidad o representacion legitima de las cuentas y la procedencia licita
de los fondos relacionados con mi solicitud. Me comprometo a aclarar
inconsistencias por un canal seguro. Esta declaracion no sustituye verificaciones,
documentacion, diligencias o formalidades que exija la normativa aplicable.

No etiquetar automaticamente una casilla como declaracion notarial o jurada con
efectos legales especificos. Confirmar forma y alcance con asesoria local.

## Revision juridica y operativa pendiente

La Ley 787 contempla la proteccion de datos personales. Es necesario revisar
aviso, base del tratamiento, derechos y transferencias con un profesional local.
No basta un consentimiento generico para justificar cualquier uso de datos.
[Fuente oficial: Ley 787](https://legislacion.asamblea.gob.ni/normaweb.nsf/9e314815a08d4a6206257265005d21f9/e5d37e9b4827fc06062579ed0076ce1d).

La reforma de 2024 recoge servicios de compraventa/cambio de moneda en modalidades
fisicas o electronicas. La clasificacion depende de la actividad real, incluida
la realizada fuera de la web. Revisar licencias, supervisor, presencia local,
debida diligencia y conservacion antes de operar con clientes.
[Fuente oficial: reforma de la Ley 977](https://legislacion.asamblea.gob.ni/__062569d000710dd9.nsf/09cf45d6fc893868062572650059911e/33312163e6f10e2106258b90006c788a).

Se localizo ademas una reforma posterior, Ley 1282, publicada el 19/06/2026.
El PDF oficial no pudo recuperarse completo durante esta revision; no presentar
el texto de 2024 como marco consolidado vigente ni afirmar cumplimiento integral.
[Documento oficial localizado en UAF](https://www.uaf.gob.ni/images/Pdf/Leyes/Ley_No._1282_Ley_de_Reformas_y_Adiciones_a_la_Ley_N_977_Ley_N_976_Ley_N_641_Ley_N_406_y_Ley_N_735.pdf).

[Privacidad de Cloudflare](https://www.cloudflare.com/privacypolicy/).
[Privacidad de Resend](https://resend.com/legal/privacy-policy).

Antes de abrir el registro: completar los campos pendientes, aprobar el texto, versionar
las aceptaciones en el servidor, ofrecer consulta previa al registro y probar
el procedimiento de derechos/eliminacion. Mantener REGISTRATION_OPEN y KYC_OPEN
en false hasta terminar esos pasos.

## Publicacion informativa del 26 de septiembre de 2026

El titular confirma SoftOhm Systems LLC y autoriza publicar
info@softohmsystems.com. Expresamente no autoriza publicar domicilio comercial.
No se considera resuelto el requisito de identificacion/domicilio del responsable
del articulo 7 de la Ley 787. Pendiente de revision juridica antes de apertura.

Se publican /terminos.html y /privacidad.html en el dominio principal, con enlaces
desde el portal, describiendo la etapa informativa, las limitaciones y los datos
reales del sistema. El nombre comercial solicitado es Tarjeta de regalo
electronica; se explica expresamente el modelo de deposito bancario previsto.
No hay emision, cobro, canje ni autorizacion regulatoria implementados.

Se retiran los cargadores automaticos de analitica y publicidad de la landing.
No se elimina informacion existente ni se modifican secretos. Los plazos concretos
de conservacion, el procedimiento de borrado y las condiciones comerciales siguen
pendientes; el registro y la recepcion de perfiles permanecen cerrados.

## Ajuste del producto y tickets

La referencia comercial revisada fue el producto "Certificado de Regalo en
Efectivo" de tuNicaragua. No se copian su tabla de precios ni sus afirmaciones
como si fueran condiciones de Saldo Express. Se adaptan las condiciones operativas
confirmadas por el titular: una cuenta bancaria por ticket, cuentas corrientes o
de ahorro, pago desde PayPal verificado, solo mayores de edad y revision de los
datos bancarios antes del deposito.

La tarjeta de regalo admite USD 25 a USD 500 por solicitud. Un monto desde
USD 500.01 se clasifica en el servidor como Metodo internacional, hasta USD 3,000.
La comision no se publica como tabla fija: se calcula con la configuracion vigente
y el ticket muestra monto base, costos estimados y valor estimado de la tarjeta.
El registro y la recepcion de perfiles continuan cerrados.
