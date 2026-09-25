const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../calculator-core.js");
test("estimaciones usan los importes y rangos de la calculadora existente", () => {
  for (const [amount, mode, net] of [
    [10000, "express", 8830],
    [16400, "express", 14500],
    [20000, "express", 17690],
    [50000, "express", 44725],
    [60000, "international", 54693],
    [300000, "international", 276549],
  ]) {
    const result = C.estimate(amount, mode);
    assert.equal(result.net, net);
    assert.equal(
      result.net + result.paypal + result.delivery + result.service,
      amount,
    );
    assert.ok(
      Math.abs(
        result.net -
          Math.round(
            C.computeFees(C.siteConfig.serviceModes[mode], amount / 100).net *
              100,
          ),
      ) <= 1,
    );
  }
});
test("limites por modalidad y centavos invalidos se rechazan", () => {
  for (const [amount, mode] of [
    [0, "express"],
    [2499, "express"],
    [50001, "express"],
    [50000, "international"],
    [300001, "international"],
    [10000, "invalid"],
    [10000.5, "express"],
  ])
    assert.throws(() => C.estimate(amount, mode));
  assert.doesNotThrow(() => C.estimate(50001, "international"));
});
test("calculo inverso mantiene el neto por ambos lados del tope", () => {
  for (const mode of Object.values(C.siteConfig.serviceModes))
    for (const amount of [25, 100, 164, 200, 348.33, 500, 1500, 3000]) {
      const net = C.computeFees(mode, amount).net;
      assert.ok(Math.abs(C.reverseGross(mode, net) - amount) < 0.00001);
    }
});
test("estimaciones guardadas no cambian si se modifica la configuracion posterior", () => {
  const result = C.estimate(16400, "express");
  const original = C.siteConfig.serviceModes.express.rate;
  try {
    C.siteConfig.serviceModes.express.rate = 0.1;
    assert.equal(result.service, 492);
    assert.equal(result.net, 14500);
  } finally {
    C.siteConfig.serviceModes.express.rate = original;
  }
});
