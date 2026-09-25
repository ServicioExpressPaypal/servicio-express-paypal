const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./domain.js');
const ticket = () => ({ id:'SE-TEST-1', name:'Cliente de prueba', email:'cliente@example.com', amount:10000, currency:'USD', status:'submitted', events:[] });
const quote = { received:'90.00', fee:'10.00', rate:'1', hours:24, validity:60 };
test('montos en centavos, sin flotantes, negativos ni notación exponencial', () => {
  assert.equal(M.cents('164.01'),16401);
  for(const value of ['-1','0','1e3','10.001','NaN','', 'Infinity'])assert.throws(() => M.cents(value));
});
test('una solicitud no puede saltar directamente a cotizada', () => {
  assert.throws(() => M.transition(ticket(),'quoted'));
  assert.throws(() => M.quote(ticket(),quote));
});
test('la cotización valida la comisión, calcula vigencia y nunca confirma un pago', () => {
  const t=ticket();M.transition(t,'reviewing',1000);M.quote(t,quote,2000);
  assert.equal(t.status,'quoted');assert.equal(t.quote.expiresAt,3602000);
  assert.equal(t.quote.received,9000);assert.equal(t.events.length,2);
  assert.throws(() => M.transition(t,'paid'));
});
test('no acepta un neto o tipo de cambio que no corresponden', () => {
  const t=ticket();M.transition(t,'reviewing');
  assert.throws(() => M.quote(t,{...quote,received:'91'}));
  t.currency='NIO';assert.throws(() => M.quote(t,{...quote,rate:'36.5667'}));
  M.quote(t,{...quote,received:'3291.00',rate:'36.5667'});
  assert.equal(t.quote.received,329100);
});
test('factura incluye referencia única, monto completo y nunca cédula ni cuenta bancaria', () => {
  const t=ticket();M.transition(t,'reviewing');M.quote(t,quote);
  const inv=M.invoicePreview(t,{name:'Prueba',email:'comercio@example.com'},'Operación de prueba');
  assert.equal(inv.detail.reference,t.id);assert.equal(inv.items[0].unit_amount.value,'100.00');
  assert.equal(inv.primary_recipients[0].billing_info.email_address,t.email);
  assert.equal(inv.configuration.partial_payment.allow_partial_payment,false);
  assert.equal(inv.configuration.allow_tip,false);
  assert.doesNotMatch(JSON.stringify(inv),/cedula|bank_account|password/);
});
test('no prepara factura con una cotización vencida o ticket cancelado', () => {
  const t=ticket();M.transition(t,'reviewing',0);M.quote(t,quote,1000);
  assert.throws(() => M.invoicePreview(t,{},'Prueba de factura',3601000));
  M.transition(t,'cancelled');assert.throws(() => M.invoicePreview(t,{},'Prueba de factura',2000));
});
test('cerrar o cancelar impide cambios posteriores', () => {
  const t=ticket();M.transition(t,'cancelled');assert.throws(() => M.transition(t,'reviewing'));
});
