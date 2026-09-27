const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./home-calculators.js");

test("PayPal calcula el bruto necesario para recibir un neto", () => {
  const result = C.paypalReceive(100);
  assert.ok(Math.abs(result.gross - 100.3 / 0.946) < 1e-10);
  assert.ok(Math.abs(result.fee - (result.gross - 100)) < 1e-10);
});

test("PayPal calcula comisión y neto desde el monto enviado", () => {
  assert.deepEqual(C.paypalSend(100), {
    gross: 100,
    fee: 5.7,
    net: 94.3,
  });
});

test("Payoneer usa el saldo, el cargo ATM y múltiplos de veinte", () => {
  const result = C.payoneerAtm(200);
  assert.equal(result.atm, 7);
  assert.equal(result.withdrawal, 180);
  assert.ok(Math.abs(result.fee - 6.86) < 1e-10);
  assert.ok(Math.abs(result.remaining - 6.14) < 1e-10);
});

test("montos vacíos o inválidos producen resultados en cero", () => {
  assert.deepEqual(C.paypalSend(-1), { gross: 0, fee: 0, net: 0 });
  assert.deepEqual(C.payoneerAtm("dato"), {
    balance: 0,
    fee: 0,
    atm: 0,
    withdrawal: 0,
    remaining: 0,
  });
});
