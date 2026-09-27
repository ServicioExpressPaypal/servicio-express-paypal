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
    assert.match(read("index.html"), new RegExp(`href="${path}"`));
    assert.ok(read(".github/workflows/pages.yml").includes(path));
    assert.ok(read("cloudflare/portal/public/index.html").includes(path));
  }
});

test("public calculator does not load advertising or analytics scripts", () => {
  const script = read("script.js");
  assert.doesNotMatch(
    script,
    /googletagmanager|googlesyndication|gtag\(|sendBeacon|loadExternalScript|wireDeferredThirdPartyScripts/,
  );
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
