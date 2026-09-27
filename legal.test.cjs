const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const read = (path) => readFileSync(join(__dirname, path), "utf8");

test("public legal pages identify the confirmed business and contact without signup", () => {
  for (const path of ["terminos.html", "privacidad.html"]) {
    const html = read(path);
    assert.match(html, /SoftOhm Systems LLC/);
    assert.match(html, /mailto:info@softohmsystems.com/);
    assert.match(html, /Registro/);
    assert.doesNotMatch(html, /<form|<script/i);
    assert.ok(read(".github/workflows/pages.yml").includes(path));
    assert.ok(read("cloudflare/portal/public/index.html").includes(path));
  }
  assert.match(read("index.html"), /href="privacidad\.html"/);
});

test("public calculator does not load advertising or analytics scripts", () => {
  const html = read("index.html");
  const script = read("home.js");
  const forbidden =
    /googletagmanager|googlesyndication|gtag\(|sendBeacon|loadExternalScript|wireDeferredThirdPartyScripts|facebook\.com\/tr/i;
  assert.doesNotMatch(html, forbidden);
  assert.doesNotMatch(script, forbidden);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|WebSocket/);
});

test("home is an informational calculator without account or cash-out flows", () => {
  const html = read("index.html");
  const workflow = read(".github/workflows/pages.yml");

  assert.match(html, /Calculadoras de comisiones\./);
  assert.match(html, /No cambiamos saldo\./);
  assert.match(html, /Cálculo 100% en tu navegador/);
  assert.match(html, /No recibimos transferencias/);
  assert.match(html, /No recibimos saldo ni\s+\n?\s*hacemos depósitos/);
  assert.match(html, /href="privacidad\.html"/);
  assert.match(
    html,
    /https:\/\/wa\.me\/50586199889\?text=Hola%2C%20vi%20las%20calculadoras/,
  );

  for (const id of [
    "paypal-receive",
    "paypal-send",
    "payoneer-balance",
    "atm-withdrawal",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.doesNotMatch(html, /portal\.saldoexpressnicaragua\.com/);
  assert.doesNotMatch(
    html,
    /id="(?:calcAmount|serviceMode|bank|cedula|email)"/i,
  );
  assert.doesNotMatch(html, /<input[^>]+type="(?:email|password|file)"/i);
  assert.doesNotMatch(html, /<script[^>]+(?:script\.js|calculator-core\.js)/i);

  for (const file of ["home.css", "home.js", "home-calculators.js"]) {
    assert.ok(workflow.includes(file), `${file} must be deployed`);
  }
});

test("production registration and profile intake stay closed", () => {
  const config = read("cloudflare/portal/wrangler.jsonc");
  for (const flag of ["REGISTRATION_OPEN", "KYC_OPEN", "ADMIN_SETUP_OPEN"]) {
    assert.match(config, new RegExp(`"${flag}":\\s*"false"`));
  }
  assert.match(
    read("cloudflare/portal/public/certificate.js"),
    /Tarjeta de regalo electrónica/,
  );
});

test("terms describe automatic ticket modes without a commission table", () => {
  const terms = read("terminos.html");
  assert.match(terms, /\$25 a \$500/);
  assert.match(terms, /supera \$500/);
  assert.match(terms, /Método internacional/);
  assert.match(terms, /cuenta de PayPal verificada/);
  assert.match(terms, /valor estimado de la tarjeta de regalo/);
  assert.doesNotMatch(terms, /<table/i);
});
