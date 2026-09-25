const { test } = require("node:test");
const assert = require("node:assert/strict");
const A = require("./accounts.js");
const photo = { type: "image/png", size: 100 };
const data = () => ({
  name: "Persona de Prueba",
  cedula: "000-000000-0000A",
  source: "Salario",
  detail: "Ingresos ficticios por trabajo asalariado",
  front: photo,
  back: photo,
  declaration: true,
  terms: true,
  privacy: true,
});
const registered = () => A.register("PRUEBA@example.com", "demo-password-123");
const verified = () => {
  const a = registered();
  A.verify(a);
  return a;
};
const pending = () => {
  const a = verified();
  A.submit(a, data());
  return a;
};
test("registro normaliza correo y no conserva contraseña", () => {
  const a = registered();
  assert.equal(a.email, "prueba@example.com");
  assert.equal(a.status, "unverified");
  assert.ok(!JSON.stringify(a).includes("demo-password"));
  assert.throws(() => A.register("invalid", "long-password"));
  assert.throws(() => A.register("a@b.com", "short"));
});
test("no permite enviar KYC o activar antes de verificar correo", () => {
  const a = registered();
  assert.throws(() => A.submit(a, data()));
  assert.throws(() => A.review(a, "activate", "Revisado"));
  assert.throws(() => A.requireActive(a));
});
test("correo verificado no activa y no puede verificarse de nuevo", () => {
  const a = verified();
  assert.equal(a.status, "incomplete");
  assert.throws(() => A.verify(a));
  assert.throws(() => A.requireActive(a));
});
test("KYC requiere nombre, formato de cedula, fuente y explicación", () => {
  for (const patch of [
    { name: "X" },
    { cedula: "123" },
    { source: "invalid" },
    { detail: "breve" },
  ]) {
    const a = verified();
    assert.throws(() => A.submit(a, { ...data(), ...patch }));
    assert.equal(a.status, "incomplete");
  }
});
test("ambas fotos deben existir y tener un tipo y tamaño admisibles", () => {
  for (const patch of [
    { front: null },
    { back: null },
    { front: { type: "image/svg+xml", size: 100 } },
    { back: { type: "image/png", size: 0 } },
    { front: { type: "image/jpeg", size: 5242881 } },
  ])
    assert.throws(() => A.submit(verified(), { ...data(), ...patch }));
});
test("ningún consentimiento puede estar omitido", () => {
  for (const key of ["declaration", "terms", "privacy"])
    assert.throws(() => A.submit(verified(), { ...data(), [key]: false }));
});
test("no interpreta el texto false como consentimiento", () => {
  assert.throws(() => A.submit(verified(), { ...data(), terms: "false" }));
});
test("envío registra texto, versión y fecha y espera decisión manual", () => {
  const a = verified();
  A.submit(a, data(), 2000);
  assert.equal(a.status, "pending");
  assert.equal(a.profile.acceptedAt, 2000);
  assert.equal(a.profile.declaration, A.declaration);
  assert.equal(a.profile.version, A.version);
  assert.throws(() => A.requireActive(a));
  assert.throws(() => A.submit(a, data()));
});
test("corrección permite reenviar sin activar automáticamente", () => {
  const a = pending();
  A.review(a, "correct", "Falta nitidez en el reverso");
  assert.equal(a.status, "correction");
  assert.throws(() => A.review(a, "activate", "Revisado"));
  A.submit(a, data());
  assert.equal(a.status, "pending");
  assert.equal(a.reason, "");
  assert.equal(a.events.length, 5);
});
test("activar requiere expediente y motivo y permite solicitar", () => {
  const a = pending();
  assert.throws(() => A.review(a, "activate", ""));
  A.review(a, "activate", "Documentos revisados");
  assert.doesNotThrow(() => A.requireActive(a));
  assert.throws(() => A.submit(a, data()));
});
test("suspensión bloquea solicitudes y reactivación las permite", () => {
  const a = pending();
  A.review(a, "activate", "Documentos revisados");
  A.review(a, "suspend", "Verificación adicional");
  assert.throws(() => A.requireActive(a));
  A.review(a, "reactivate", "Revisión completada");
  assert.doesNotThrow(() => A.requireActive(a));
});
test("cierre conserva expediente e historial y no permite reactivación", () => {
  const a = pending();
  A.review(a, "close", "Solicitud de cierre");
  assert.equal(a.status, "closed");
  assert.ok(a.profile.front);
  assert.equal(a.events.at(-1).message, "Cerrada: Solicitud de cierre");
  assert.throws(() => A.review(a, "reactivate", "Revisión completada"));
  assert.throws(() => A.requireActive(a));
});
