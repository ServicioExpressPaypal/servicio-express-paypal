const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const read = (path) => readFileSync(join(__dirname, path), "utf8");

test("legal notices are linked from the live public site", () => {
  const workflow = read(".github/workflows/pages.yml");
  const home = read("index.html");
  const portal = read("cloudflare/portal/public/index.html");
  for (const path of ["terminos.html", "privacidad.html"]) {
    const html = read(path);
    assert.match(html, /SoftOhm Systems LLC/);
    assert.match(html, /mailto:soportesaldoexpress@gmail.com/);
    assert.match(html, /registro/i);
    assert.doesNotMatch(html, /<form|<script/i);
    assert.match(home, new RegExp(`href="${path}"`));
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

test("public site launches the product and links to the protected portal", () => {
  const home = read("index.html");
  const portal = read("cloudflare/portal/public/index.html");
  const certificate = read("cloudflare/portal/public/certificate.js");

  assert.match(home, /Certificado de regalo en efectivo/);
  assert.match(home, /portal\.saldoexpressnicaragua\.com/);
  assert.match(home, /Crear cuenta o ingresar/i);
  assert.match(home, /Registro abierto/);
  assert.doesNotMatch(home, /Sitio en construcción|Registro cerrado/);
  assert.match(portal, /Sitio en construcción/);
  assert.match(certificate, /Certificado de regalo en efectivo/);
  assert.match(certificate, /compartir con tu familia/);
  assert.doesNotMatch(certificate, /Tarjeta de regalo electrónica/);
  assert.match(read("robots.txt"), /Allow: \/$/m);
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
    /6 días hábiles/,
    /15 minutos/,
    /30 días/,
    /Cloudflare/,
    /Resend/,
    /nombre completo, teléfono de contacto/,
    /no guarda números de tarjeta/,
  ])
    assert.match(privacy, phrase);
  const build = read("cloudflare/portal/scripts/build.mjs");
  assert.match(build, /privacidad.html/);
  assert.match(build, /terminos.html/);
  const app = read("cloudflare/portal/public/app.js");
  assert.match(app, /legalAccepted/);
  assert.match(app, /legalVersion/);
});

test("terms describe the digital gift certificate, payment methods and ticket modes", () => {
  const terms = read("terminos.html").replace(/\s+/g, " ");
  assert.match(terms, /certificado electrónico de regalo/);
  assert.match(terms, /producto digital/);
  assert.match(terms, /PayPal o con tarjeta/);
  assert.match(terms, /\$25 a \$500/);
  assert.match(terms, /supera \$500/);
  assert.match(terms, /Método internacional/);
  assert.match(terms, /no completa la compra ni emite el certificado/);
  assert.match(terms, /un solo beneficiario.*una sola cuenta/s);
  assert.match(terms, /24 horas de\s+vigencia/);
  assert.match(terms, /6 días hábiles/);
  assert.match(terms, /Una vez entregado el certificado no hay reembolso/);
  assert.match(terms, /canal oficial de WhatsApp/);
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

const flat = (path) => read(path).replace(/\s+/g, " ");

test("legal texts are plain: digital gift certificate, PayPal or card, no statute or country references", () => {
  for (const path of ["terminos.html", "privacidad.html"]) {
    const text = flat(path).replace(/href="[^"]*"/g, "");
    assert.doesNotMatch(text, /Nicaragua|Ley \d|artículo \d|días hábiles desde esa verificación|si necesitamos más tiempo/i);
    assert.match(text, /PayPal o con tarjeta/);
  }
  assert.match(flat("terminos.html"), /certificado electrónico de regalo/);
});

test("legal versions and visible date are consistent across certificate.js and both notices", () => {
  const certificate = read("cloudflare/portal/public/certificate.js");
  const version = certificate.match(/const version = "([^"]+)"/)[1];
  const ticket = certificate.match(
    /const ticketConditionsVersion = "([^"]+)"/,
  )[1];
  const date = version.match(/(\d{4})-(\d{2})-(\d{2})-v\d+$/);
  assert.ok(date, "version must end with YYYY-MM-DD-vN");
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const visible = `${Number(date[3])} de ${months[Number(date[2]) - 1]} de ${date[1]}`;
  const terms = flat("terminos.html");
  const privacy = flat("privacidad.html");
  assert.ok(terms.includes(`Cuenta: ${version}`));
  assert.ok(terms.includes(`Ticket: ${ticket}`));
  assert.ok(terms.includes(`Vigente desde el ${visible}`));
  assert.ok(privacy.includes(`Versión ${version} · ${visible}`));
  assert.ok(terms.includes(`ticket-condiciones-${ticket.split("ticket-condiciones-")[1]}`));
  assert.match(terms, /versión vigente y su fecha se publican en esta página/);
});

test("version bump keeps existing consents and documents why", () => {
  const certificate = read("cloudflare/portal/public/certificate.js");
  assert.match(certificate, /not a material change/);
  assert.match(certificate, /existing accounts keep the version they accepted/);
  const text = flat("privacidad.html");
  assert.match(text, /las cuentas existentes conservan la que aceptaron/);
  assert.match(text, /pediremos nueva aceptación antes de aplicarlo/);
});
