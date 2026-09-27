const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const read = (path) => readFileSync(join(__dirname, path), "utf8");

test("legal drafts stay preserved in source but are not published during maintenance", () => {
  const workflow = read(".github/workflows/pages.yml");
  const home = read("index.html");
  const portal = read("cloudflare/portal/public/index.html");
  for (const path of ["terminos.html", "privacidad.html"]) {
    const html = read(path);
    assert.match(html, /SoftOhm Systems LLC/);
    assert.match(html, /mailto:info@softohmsystems.com/);
    assert.match(html, /Registro/);
    assert.doesNotMatch(html, /<form|<script/i);
    assert.doesNotMatch(home, new RegExp(`href="${path}"`));
    assert.doesNotMatch(workflow, new RegExp(path));
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
    assert.doesNotMatch(page, /Certificado de regalo|PayPal|Payoneer|<form|<script/i);
    assert.doesNotMatch(page, /SoftOhm|mailto:|Saldo Express|<footer|<img/i);
  }
  assert.match(certificate, /Certificado de regalo en efectivo/);
  assert.match(certificate, /familiar o beneficiario en Nicaragua/);
  assert.doesNotMatch(certificate, /Tarjeta de regalo electrónica/);
  assert.match(read("robots.txt"), /Disallow: \/$/m);
});

test("production registration and profile intake stay closed", () => {
  const config = read("cloudflare/portal/wrangler.jsonc");
  for (const flag of ["REGISTRATION_OPEN", "KYC_OPEN", "ADMIN_SETUP_OPEN"]) {
    assert.match(config, new RegExp(`"${flag}":\\s*"false"`));
  }
  assert.match(config, /"MAINTENANCE_MODE":\s*"true"/);
  assert.match(
    read("cloudflare/portal/public/certificate.js"),
    /Certificado de regalo en efectivo/,
  );
});

test("terms describe automatic ticket modes without a commission table", () => {
  const terms = read("terminos.html");
  assert.match(terms, /\$25 a \$500/);
  assert.match(terms, /supera \$500/);
  assert.match(terms, /Método internacional/);
  assert.match(terms, /cuenta de PayPal verificada/);
  assert.match(terms, /valor estimado del certificado/);
  assert.match(terms, /familiar u otro beneficiario designado en Nicaragua/);
  assert.match(terms, /una sola\s+cuenta bancaria.*beneficiario/s);
  assert.match(terms, /vigencia de 24 horas/);
  assert.match(terms, /canal\s+oficial de WhatsApp/s);
  assert.match(terms, /nombre comercial no cambia/i);
  assert.match(terms, /Banco Central de Nicaragua/);
  assert.doesNotMatch(terms, /<table/i);
});

test("ticket source includes the 24-hour conversation and WhatsApp handoff", () => {
  const app = read("cloudflare/portal/public/app.js");
  const migration = read("cloudflare/portal/migrations/0004_ticket_chat.sql");
  assert.match(app, /Conversación del ticket/);
  assert.match(app, /wa\.me\/50586199889/);
  assert.match(app, /vigencia de 24 horas/);
  assert.match(migration, /CREATE TABLE ticket_messages/);
  assert.match(migration, /86400000/);
});
