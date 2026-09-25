# Saldo Express Nicaragua: viabilidad de plataforma y cumplimiento

Fecha de investigacion: 14 de septiembre de 2026.

## Decision ejecutiva

La plataforma propuesta no debe publicarse todavia como una aplicacion que recibe saldo de un cliente y le entrega el equivalente en cordobas o dolares. Por como esta descrito el servicio, puede encuadrar simultaneamente en:

- servicio de pago de remesas: acepta fondos o medios de valor de un originador y paga una suma equivalente a un beneficiario;
- compraventa y/o cambio de moneda: recibe y entrega fondos a una tasa acordada, incluso por plataformas en linea.

Ambas definiciones aparecen expresamente en la Norma CDMF-XXIII-1-25 del BCN. La misma norma indica que solo puede operar como PSPR o PSCM quien tenga la licencia o registro correspondiente del BCN. Una empresa juridica que no sea banco o microfinanciera supervisada debe tramitar licencia; para personas juridicas el capital social minimo es C$2,000,000 para PSPR y C$4,000,000 para PSCM. Si se solicitan ambos servicios, aplica el requisito mas alto. La solicitud tambien exige demostrar viabilidad tecnica, operativa y financiera mediante un plan de negocios.

Esto significa que aceptar Terminos, una declaracion jurada y una cedula mejora el expediente de cumplimiento, pero no sustituye la licencia, registro, programa ALA/CFT/CFP ni la autorizacion del proveedor de pagos.

Fuentes principales:

- [Norma de PSPR y PSCM, Resolucion CDMF-XXIII-1-25](https://bcn.gob.ni/sites/default/files/normas_disposiciones/Norma_de_los_Proveedores_de_Servicios_de_Pago_de_Remesas_y_de_Compraventa_o_Cambio_de_Monedas.pdf)
- [Vigilancia financiera y definiciones vigentes del BCN](https://www.bcn.gob.ni/vigilancia-financiera)
- [Listado oficial de proveedores de tecnologia financiera de pago autorizados](https://bcn.gob.ni/proveedores-de-servicios-de-pago-de-remesas)
- [Ley 977, con reformas de 2026](https://www.uaf.gob.ni/images/Pdf/Leyes/Ley_No._1282_Ley_de_Reformas_y_Adiciones_a_la_Ley_N_977_Ley_N_976_Ley_N_641_Ley_N_406_y_Ley_N_735.pdf)

## Ruta recomendada

### Fase 0: dictamen y aliado regulado

Antes de recibir datos o pagos para una orden, contratar asesoria legal nicaraguense especializada en regulacion financiera y solicitar al BCN una confirmacion escrita de la clasificacion del modelo: PSPR, PSCM, proveedor de tecnologia financiera de servicios de pago, o una combinacion.

La ruta mas realista para lanzar primero es operar como plataforma de solicitud y atencion para un proveedor ya autorizado, mediante un contrato escrito. El aliado regulado debe aprobar expresamente el flujo, la marca, el uso de datos, la custodia de fondos, el proceso de KYC, el esquema de subagencia si aplica y el reparto de obligaciones de reporte.

La ruta propia requiere licencia. Para una sociedad, la norma actual exige capital social minimo de C$2,000,000 para remesas o C$4,000,000 para cambio de moneda, ademas de plan de negocios y requisitos legales y operativos definidos por el BCN. El abogado debe confirmar si la LLC estadounidense puede ser solicitante o si se necesita una sociedad o estructura local.

No debe iniciarse la operacion bajo la etiqueta de "servicio de software" si en la practica se reciben fondos de clientes y se entrega su equivalente. La sustancia de la operacion, no el nombre comercial, es lo relevante para el encuadre regulatorio.

### Fase 1: portal sin custodia ni pago

Se puede construir ahora un portal privado de pre-registro y tickets, mantenido en modo piloto:

1. El usuario crea cuenta y verifica su correo y telefono.
2. Completa su perfil y solicita una cotizacion, sin transferencia de fondos ni enlace de pago.
3. Un operador revisa el caso y emite una cotizacion no vinculante.
4. El sistema registra el expediente y envia al equipo un aviso con el numero de ticket, sin cedula, cuenta bancaria ni documentos adjuntos en el correo.
5. Cuando el modelo este autorizado y el proveedor de cobro lo haya aprobado por escrito, se habilita el enlace de pago individual para el ticket.

Esta fase permite probar autenticacion, seguridad, atencion al cliente y operaciones sin presentar la plataforma como un servicio de cambio ya activo.

### Fase 2: operaciones solo despues de aprobacion regulatoria

Flujo objetivo para un proveedor autorizado o para Saldo Express con licencia:

`borrador -> perfil pendiente -> KYC en revision -> aprobado para cotizacion -> cotizacion emitida -> enlace de pago individual -> pago confirmado por webhook -> reloj de SLA iniciado -> revision de pago -> desembolso autorizado -> completado / rechazado / reembolsado`

Reglas esenciales:

- El reloj del cambio comienza unicamente con KYC aprobado y confirmacion servidor-a-servidor de pago. Nunca con el retorno visual del navegador.
- Un webhook de pago no desembolsa dinero automaticamente. Solo abre una revision operativa y de cumplimiento.
- La cotizacion debe ser inmutable: monto, moneda, comision, tasa, metodo de entrega, identificador de pago, fecha de expiracion y SLA.
- El usuario recibe recibo y estado del ticket; el administrador recibe una cola de revision. Los correos llevan solo identificador de ticket y enlace autenticado al panel.
- Los cambios de estado y las decisiones deben quedar en una bitacora inmutable con actor, fecha, motivo y evidencia asociada.

## ALA/CFT/CFP y KYC: que debe existir antes de operar

Las empresas de remesas y las casas de cambio aparecen en el ecosistema de Sujetos Obligados de la UAF. La UAF describe para estos sectores una debida diligencia basada en riesgo, un oficial de cumplimiento y procesos para detectar, analizar y reportar operaciones sospechosas. La reforma de 2026 mantiene, entre otras obligaciones, registros de ordenantes y beneficiarios de pagos o transferencias por al menos cinco anos despues de la operacion.

El expediente del cliente debe diseñarse con un abogado y oficial de cumplimiento, pero como minimo el producto debe poder soportar:

- identificacion y verificacion de identidad; no pedir mas datos de los necesarios;
- perfil transaccional esperado: origen de fondos, actividad economica, pais de origen, rango mensual, proposito y beneficiario;
- declaracion jurada versionada, con confirmacion expresa y evidencia de aceptacion;
- verificacion de titularidad de la cuenta de pago y de la cuenta receptora;
- evaluacion de riesgo, alertas, escalamiento manual y decision documentada;
- controles de sanciones, PEP y coincidencias, con procedimiento humano de falsos positivos;
- monitoreo de montos, frecuencia, fraccionamiento, reversos, cuentas compartidas y discrepancias entre identidad, pagador y beneficiario;
- retencion, bloqueo y eliminacion de datos conforme la ley, instrucciones de UAF/BCN y asesoria legal;
- capacidad para producir los registros y reportes que correspondan por los canales oficiales.

Fuentes:

- [Guia UAF para deteccion y reporte de operaciones sospechosas en compraventa/cambio de moneda](https://www.uaf.gob.ni/images/Pdf/Documentos_ALA-CFT/Guia-ROS-Compraventa-o-cambio-moneda.pdf)
- [Capacitacion UAF sobre DDC para remesas y casas de cambio](https://www.uaf.gob.ni/difuson/noticias/260-especialistas-de-la-uaf-capacitan-sobre-ddc-a-oficiales-de-cumplimiento-de-sujetos-obligados-regulados-directamente)
- [Ley 787 de Proteccion de Datos Personales](https://www.informatica-juridica.com/anexos/ley-no-787-de-21-de-marzo-de-2012-de-proteccion-de-datos-personales-nicaragua-nbsp-la-gaceta-diario-oficial-no-61-de-29-de-marzo-de-2012/)
- [Reglamento de la Ley 787, Decreto 36-2012](https://www.informatica-juridica.com/anexos/decreto-no-36-2012-de-17-de-octubre-de-2012-reglamento-de-la-ley-no-787-ley-de-proteccion-de-datos-personales-la-gaceta-diario-oficial-no-200-de-19-de-octubre-de-2012/)
- [Reglamento de la Ley 729 de Firma Electronica](https://noticias.asamblea.gob.ni/odm/OBJETIVO%208/2.REG/2011.G211.DEJ%2057-2011.REG%20LEY%20729.pdf)

## Documentos y consentimientos de producto

No usar un unico checkbox generico. Publicar y versionar por separado:

- Terminos de uso y condiciones del servicio.
- Politica de privacidad y aviso informativo previo al tratamiento de datos.
- Declaracion jurada de origen licito de fondos, veracidad y titularidad de cuentas.
- Consentimiento para verificacion de identidad y consulta de fuentes permitidas.
- Cotizacion y condiciones de cada operacion.

Cada aceptacion debe conservar: tipo de documento, version, hash del contenido, fecha/hora, cuenta autenticada, metodo de autenticacion y evidencia tecnica proporcional. La Ley 729 reconoce la firma electronica cuando sea fiable y apropiada al riesgo; para declaraciones de alto impacto se debe pedir al abogado definir el mecanismo de firma y evidencia apropiados. No almacenar contrasenas, codigos OTP de bancos/PayPal, ni credenciales financieras del cliente.

La declaracion jurada debe ser un formulario estructurado, no un campo libre: actividad/fuente, entidad que paga, pais, monto y frecuencia esperados, proposito de la operacion y documentos de respaldo cuando el perfil de riesgo lo requiera. El texto final debe ser preparado o revisado por asesoria local.

## Arquitectura recomendada

### Plataforma

```text
Usuario
  -> Cloudflare DNS + WAF + Turnstile
  -> Cloudflare Pages (frontend) / Worker (API)
  -> Supabase Auth + PostgreSQL + almacenamiento privado
  -> proveedor de email transaccional
  -> API/webhooks del proveedor de pago autorizado
  -> cola de revision de administradores
```

- Cloudflare: DNS, CDN, WAF, reglas de tasa, Turnstile, Pages y Workers. Guardar secretos solo como secretos de Worker; nunca en JavaScript publico.
- PostgreSQL: usar Supabase, que ya esta presente en este repositorio. Cloudflare D1 utiliza semantica SQLite, por lo que no es el reemplazo de PostgreSQL para este caso.
- Autenticacion: Supabase Auth con verificacion de correo; MFA obligatorio para administradores. Separar roles de atencion, cumplimiento y aprobacion de desembolso.
- Datos sensibles: tablas separadas para identidad, cuentas, consentimientos y ordenes. Cifrado de campos sensibles, archivos privados con URL firmada de corta duracion, acceso minimo y registro de cada consulta administrativa.
- Base de datos: activar RLS y quitar permisos por defecto. La `service_role` de Supabase debe vivir solo del lado servidor, porque omite RLS.
- Documentos: no activar carga de foto de cedula hasta definir proveedor de verificacion, retencion, ubicacion de datos y procedimiento de eliminacion. Nunca usar bucket publico ni adjuntar documentos a correos.
- Correo: notificacion con ID de ticket, estado y enlace autenticado. No incluir cedula, numero de cuenta, monto completo ni enlace de pago reenviable.
- Pagos: generar una orden o enlace individual asociado al ticket solo desde backend. Verificar webhooks, firma, importe, moneda e idempotencia. No confiar en el parametro de retorno del navegador.

Referencias tecnicas:

- [Cloudflare D1 usa SQLite](https://developers.cloudflare.com/d1/)
- [Cloudflare Pages: dominios personalizados](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare Workers: secretos](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Turnstile requiere validacion del lado servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Supabase PostgreSQL y respaldos](https://supabase.com/docs/guides/database/overview)
- [Supabase RLS y privilegios minimos](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Modelo de datos inicial

| Tabla | Proposito | Regla de acceso |
| --- | --- | --- |
| `profiles` | cuenta, rol y estado de acceso | usuario propio; admins con rol limitado |
| `kyc_cases` | estado de caso y resultado de revision | usuario ve su estado; cumplimiento ve expediente |
| `identity_data` | nombre y cedula cifrados | sin acceso directo desde el navegador |
| `funds_declarations` | origen de fondos y evidencia | usuario propio y cumplimiento |
| `consent_events` | documento, version, hash y fecha | solo lectura, sin actualizacion |
| `orders` | ticket y su ciclo de vida | usuario propio; operaciones limitadas |
| `quotes` | tasa, comision y caducidad inmutables | lectura controlada |
| `payment_events` | webhook original, verificado e idempotente | solo backend y auditoria |
| `payout_instructions` | datos bancarios cifrados/tokenizados | dos personas autorizadas |
| `audit_events` | trazabilidad append-only | administracion y auditoria |
| `risk_flags` | alertas, escalamiento y resolucion | cumplimiento |

El esquema actual del repositorio es un buen prototipo, pero no debe reactivarse tal como esta: hoy guarda cedula y cuenta bancaria en texto claro, no conserva version de terminos ni declaracion de fondos, y el flujo esta pausado de forma deliberada. La siguiente migracion debe reemplazarlo con el modelo anterior y pruebas de RLS antes de aceptar datos reales.

## PayPal y Wise: bloqueo contractual que hay que resolver

No conectar automaticamente el enlace de PayPal ni la cuenta Wise actual a este flujo de cambio. La politica de uso aceptable de Wise vigente indica que no admite negocios de cambio de moneda, transmision de dinero por cuenta de terceros ni procesamiento de pagos. La documentacion de PayPal describe Payment Links como cobro por productos o servicios; la politica de Braintree, una division de PayPal, lista transmisores de dinero y casas de cambio como categorias no permitidas. Esto no prueba por si solo que el contrato concreto de PayPal este prohibido, pero obliga a obtener aprobacion escrita del proveedor y a no disfrazar el servicio.

Fuentes:

- [Wise Acceptable Use Policy](https://wise.com/us/legal/acceptable-use-policy)
- [PayPal Payment Links](https://www.paypal.com/us/business/accept-payments/payment-links)
- [PayPal/Braintree Acceptable Use Policy](https://www.paypal.com/us/legalhub/braintree/acceptable-use-policy?country.x=US&locale.x=en_US)

## Migracion del dominio a Cloudflare

Es viable y recomendable, pero se debe hacer por etapas para no caer el sitio actual ni el correo:

1. Crear la zona `saldoexpressnicaragua.com` en Cloudflare y copiar todos los DNS actuales: A/AAAA/CNAME, MX, TXT, SPF, DKIM, DMARC y verificaciones.
2. Cambiar en el registrador los nameservers por los que entregue Cloudflare. Esta es la migracion real del DNS; agregar registros sin cambiar nameservers no mueve el dominio.
3. Mantener el sitio actual en GitHub Pages mientras se crea `app.saldoexpressnicaragua.com` en Cloudflare Pages/Workers para el piloto. Asi no se interrumpe la pagina publica.
4. Configurar el dominio dentro del panel de Pages; no crear solo un CNAME manual hacia `pages.dev`, porque Cloudflare requiere asociarlo primero al proyecto.
5. Probar correo, HTTPS, redirecciones, robots/noindex del piloto, WAF, Turnstile y restauracion antes de apuntar el dominio principal.
6. Cuando la plataforma este autorizada y probada, mover `www` y el dominio raiz al proyecto nuevo, conservando redirecciones y un plan de reversa.

## Entregables antes de construir Fase 2

1. Dictamen legal y respuesta de clasificacion/licencia del BCN.
2. Contrato y aprobacion escrita de banco/proveedor de pagos, o licencia propia vigente.
3. Manual ALA/CFT/CFP, matriz de riesgo, oficial de cumplimiento y procedimientos de reportes validados.
4. Terminos, privacidad y declaracion jurada preparados por abogado nicaraguense.
5. Evaluacion de impacto de privacidad, retencion y ubicacion de documentos.
6. Diseno tecnico revisado: modelo de amenazas, pruebas RLS, webhooks, cifrado, respaldo y recuperacion.
7. Piloto sin custodia, con datos sinteticos, antes de datos reales.

## Alcance de este documento

Es una investigacion de producto, regulacion publica y arquitectura tecnica. No es dictamen juridico ni autorizacion para prestar remesas, cambio de moneda, servicios de pago o tecnologia financiera en Nicaragua.
