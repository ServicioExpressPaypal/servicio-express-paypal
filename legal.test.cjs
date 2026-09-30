const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const read = (path) => readFileSync(join(__dirname, path), "utf8");

test("legal notices are published while the home stays in construction", () => {
  const workflow = read(".github/workflows/pages.yml");
  const home = read("index.html");
  const portal = read("cloudflare/portal/public/index.html");
  for (const path of ["terminos.html", "privacidad.html"]) {
    const html = read(path);
    assert.match(html, /SoftOhm Systems LLC/);
    assert.match(html, /mailto:soporte@saldoexpressnicaragua.com/);
    assert.match(html, /registro/i);
    assert.doesNotMatch(html, /<form|<script/i);
    assert.doesNotMatch(home, new RegExp(`href="${path}"`));
    assert.match(workflow, new RegExp(path));
    assert.doesNotMatch(portal, new RegExp(path));
  }
});

test("public calculator does not load advertising or analytics scripts", () => {
  const script = read("script.js");
  assert.doesNotMatch(
    script,
    /googletagmanager|googlesyndication|gtag\(|sendBeacon|loadExternalScript|wireDeferredThirdPartyScripts/,
  );
});

test("maintenance pages hide the unreleased product and application", () => {
  const home = read("index.html");
  const portal = read("cloudflare/portal/public/index.html");
  const certificate = read("cloudflare/portal/public/certificate.js");

  for (const page of [home, portal]) {
    assert.match(page, /Sitio en construcción/);
    assert.doesNotMatch(
      page,
      /Certificado de regalo|PayPal|Payoneer|<form|<script/i,
    );
    assert.doesNotMatch(page, /SoftOhm|mailto:|Saldo Express|<footer|<img/i);
  }
  assert.match(certificate, /Certificado de regalo en efectivo/);
  assert.match(certificate, /compartir con tu familia/);
  assert.doesNotMatch(certificate, /Tarjeta de regalo electrónica/);
  assert.match(read("robots.txt"), /Disallow: \/$/m);
});

test("production registration requires server-side bot protection and private admin setup", () => {
  const config = read("cloudflare/portal/wrangler.jsonc");
  assert.match(config, /"ADMIN_SETUP_OPEN":\s*"false"/);
  assert.match(config, /"MAINTENANCE_MODE":\s*"false"/);
  assert.match(config, /"TURNSTILE_ENABLED":\s*"true"/);
  assert.match(config, /"REGISTRATION_OPEN":\s*"true"/);
  assert.match(config, /"ADMIN_REQUIRE_MFA":\s*"true"/);
  assert.match(config, /"KYC_OPEN":\s*"true"/);
  assert.match(config, /"ratelimits"/);
  assert.match(
    read("cloudflare/portal/public/certificate.js"),
    /Certificado de regalo en efectivo/,
  );
});

test("privacy matches temporary destination data and minimal registration", () => {
  const privacy = read("privacidad.html").replace(/\s+/g, " ");
  for (const phrase of [
    /hash/,
    /24 horas/,
    /15 minutos/,
    /30 días/,
    /Cloudflare/,
    /Resend/,
    /HMAC/,
    /no constituyen certificación de identidad/,
  ])
    assert.match(privacy, phrase);
  const build = read("cloudflare/portal/scripts/build.mjs");
  assert.match(build, /privacidad.html/);
  assert.match(build, /terminos.html/);
  const app = read("cloudflare/portal/public/app.js");
  assert.match(app, /legalAccepted/);
  assert.match(app, /legalVersion/);
  assert.match(privacy, /nombre completo, teléfono de contacto/);
  assert.match(privacy, /No pedimos ni guardamos un correo de PayPal separado/);
  assert.match(privacy, /declaración de titularidad no verifica/);
  assert.match(privacy, /2 días hábiles, de lunes a viernes/);
  assert.doesNotMatch(privacy, /No solicitamos nombre legal/);
});

test("terms describe automatic ticket modes without a commission table", () => {
  const terms = read("terminos.html").replace(/\s+/g, " ");
  assert.match(terms, /\$25 a \$500/);
  assert.match(terms, /supera \$500/);
  assert.match(terms, /Método internacional/);
  assert.match(terms, /cuenta de PayPal verificada/);
  assert.match(terms, /valor estimado del certificado/);
  assert.match(terms, /producto de regalo de valor monetario/);
  assert.match(terms, /solicitud se gestiona de forma digital/);
  assert.match(terms, /no completa la compra ni emite el certificado/);
  assert.match(terms, /un solo familiar o beneficiario.*una sola cuenta/s);
  assert.match(terms, /Express: 24 horas de vigencia/);
  assert.match(terms, /6 días hábiles desde la creación/);
  assert.match(terms, /No ofrecemos reembolsos voluntarios/);
  assert.match(terms, /servicio no prestado/);
  assert.match(terms, /derechos irrenunciables/);
  assert.doesNotMatch(terms, /cotización definitiva requiere/);
  assert.match(terms, /canal\s+oficial de WhatsApp/s);
  const description = terms.split("<h2>Certificado de regalo en efectivo</h2>")[1].split("<h2>Condiciones del ticket</h2>")[0];
  assert.doesNotMatch(description, /Nicaragua|banco|autoridades|depósito/i);
  assert.doesNotMatch(terms, /<table/i);
});

test("ticket source includes the 24-hour conversation and WhatsApp handoff", () => {
  const app = read("cloudflare/portal/public/app.js");
  const migration = read("cloudflare/portal/migrations/0004_ticket_chat.sql");
  assert.match(app, /Conversación del ticket/);
  assert.match(app, /wa\.me\/50586199889/);
  assert.match(app, /vigencia es de 24 horas/);
  assert.match(app, /6 días hábiles desde la confirmación del pago/);
  assert.match(migration, /CREATE TABLE ticket_messages/);
  assert.match(migration, /86400000/);
});

test("each ticket records one beneficiary account and accepted conditions", () => {
  const app = read("cloudflare/portal/public/app.js");
  const certificate = read("cloudflare/portal/public/certificate.js");
  const migration = read(
    "cloudflare/portal/migrations/0005_ticket_destination.sql",
  );
  for (const field of ["beneficiaryName", "bankAccount", "bank", "currency"])
    assert.match(app, new RegExp(`\\"${field}\\"`));
  assert.match(certificate, /cuentas verificadas por PayPal/);
  assert.match(certificate, /límite de USD 500 por ticket/);
  assert.match(certificate, /No se aceptan solicitudes de personas menores/);
  assert.match(migration, /beneficiary_name/);
  assert.match(migration, /bank_account/);
  assert.match(migration, /terms_accepted_at/);
});

test("admin dashboard keeps account decisions manual and notifies the user", () => {
  const app = read("cloudflare/portal/public/app.js");
  const worker = read("cloudflare/portal/src/worker.ts");
  const migration = read(
    "cloudflare/portal/migrations/0006_account_notices.sql",
  );
  assert.match(app, /Resumen administrativo/);
  assert.match(app, /Activar cuenta/);
  assert.match(app, /Suspender cuenta/);
  assert.match(app, /Cerrar cuenta/);
  assert.match(app, /Confirmar y avisar/);
  assert.match(worker, /notifyAccountDecision/);
  assert.match(worker, /Tu cuenta debe estar activada para crear solicitudes/);
  assert.match(migration, /CREATE TABLE account_notices/);
  assert.match(migration, /delivered/);
});
