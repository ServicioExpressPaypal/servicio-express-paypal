# Piloto local de registro, KYC y tickets

Abrir `index.html` directamente en un navegador. Sin servidor ni instalacion.

Vista publicada: `https://saldoexpressnicaragua.com/_pilot/tickets/`.
Conserva las mismas limitaciones del prototipo local. `noindex` no es un control
de acceso: cualquier persona con el enlace puede abrir la demostracion.

Todos los perfiles son ficticios. Datos solo en memoria. No hay autenticacion ni
servicios externos conectados. No se debe usar para datos personales reales ni
publicarse como un portal privado.

## Recorrido

1. En Cliente, registrar un correo y una contrasena ficticios (12 caracteres).
2. Simular la verificacion del correo. No se envia ningun mensaje real.
3. Completar nombre, cedula, dos imagenes ficticias JPG/PNG de hasta 5 MB por cara,
   origen de fondos y los tres consentimientos independientes.
4. Cambiar a Administrador > Usuarios > Revisar. Pedir correccion o activar.
5. Volver a Cliente > Mis solicitudes para crear un ticket.
6. Administrador puede suspender, reactivar o cerrar con motivo e historial.

El selector Cliente/Administrador existe exclusivamente para recorrer el prototipo:
no es un control de seguridad. No hay login persistente ni recuperacion de cuenta.
La contrasena se descarta al registrar; no se guarda ni valida posteriormente.
Los archivos solo se previsualizan localmente. No se usan localStorage, cookies,
IndexedDB, cargas de red ni almacenamiento en disco. Recargar reinicia la demo.
El prototipo permite un registro nuevo por sesion; los tickets precargados son
ejemplos independientes. La verificacion del formato de cedula no prueba identidad.

La interfaz pide ambos lados porque asi lo solicito el propietario. Esta seleccion
de campos no constituye una determinacion de suficiencia legal del KYC.

Ver `../../docs/registro-kyc-2026-09-23.md` para estados, controles de produccion
y limites de los textos legales. La landing publica no se modifico.

Ver `../../docs/tickets-facturacion-2026-09-23.md` para el alcance y la integracion
investigada con PayPal, WhatsApp, Cloudflare y PostgreSQL.

Pruebas de dominio: `node --test _pilot/tickets/domain.test.cjs _pilot/tickets/accounts.test.cjs _pilot/tickets/calculator.test.cjs`, desde la raiz.
Pruebas de navegador: `node _pilot/tickets/browser.test.cjs`, con Playwright
disponible y Chrome instalado. Las capturas se escriben en `/tmp/saldo-express-pilot`.

Iconos: Lucide, copia local del paquete incluido en el runtime. Licencia en
`lucide-LICENSE`. No hay dependencias de CDN.

La calculadora del ticket comparte `../../calculator-core.js` con la landing.
Regresion de la pagina publica: `node _pilot/tickets/public-calculator.test.cjs`
con Playwright y Chrome. Las solicitudes a terceros se interceptan en esta prueba.
Ver `../../docs/calculadora-tickets-2026-09-23.md` para el alcance y los limites
de facturacion: no se activa la API ni se factura el saldo como asesoria.
