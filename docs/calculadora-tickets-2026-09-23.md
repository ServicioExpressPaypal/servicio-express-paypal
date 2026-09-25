# Calculadora conectada a tickets

Implementacion local. No se han enviado facturas ni cambiado el despliegue.

La landing y el piloto usan `calculator-core.js`. Se conservan las tarifas y rangos
que estaban configurados, no se presentan como tarifas externas verificadas en vivo.
Express: USD 25 a 500; Internacional: USD 500.01 a 3000.

El cliente obtiene una estimacion y el ticket guarda su version, monto, modalidad,
costos PayPal, procesamiento, comision propia, total y neto en USD. Se redondean
los componentes a centavos para que sumen exactamente; el resultado puede diferir
un centavo del estimador publico que redondea al mostrar sus numeros.

El administrador ve el mismo desglose guardado y el formulario de cotizacion se
rellena con esos costos. La entrega en NIO requiere tasa indicada por el operador;
no se inventa una tasa. La estimacion no confirma disponibilidad ni ejecucion.

## Limite de facturacion

El ticket no es una factura. Saldo declarado, neto previsto, comision por una
operacion y honorario de asesoramiento son conceptos distintos. No se genero una
factura de asesoria por el saldo completo ni se cambio el concepto de una operacion
para presentarla como un servicio diferente. La vista previa existente requiere
descripcion del concepto real y sigue sin enviar datos a PayPal.

La automatizacion real requiere confirmar el servicio y precio que se facturaran,
admisibilidad con PayPal, credenciales de servidor de la entidad que factura,
pruebas sandbox, aprobacion del operador y conciliacion de pagos. El correo externo
no elimina los requisitos de la actividad subyacente. No se habilito envio automatico.

Nota sobre costos: el retiro ATM de la calculadora especifica de Payoneer tiene
cargo de operador de USD 7. La calculadora principal utiliza otro modelo de
procesamiento (3% con tope USD 10.45). Se conservaron ambos modelos existentes;
no se presupone que esos importes representen el mismo concepto.
