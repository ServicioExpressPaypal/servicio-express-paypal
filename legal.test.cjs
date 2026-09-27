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

test("public product name and centered footer stay consistent", () => {
  const home = read("index.html");
  const styles = read("styles.css");
  const certificate = read("cloudflare/portal/public/certificate.js");

  assert.match(home, /Certificado de regalo en efectivo/);
  assert.match(certificate, /Certificado de regalo en efectivo/);
  assert.match(home, /familiar o beneficiario en Nicaragua/);
  assert.match(certificate, /familiar o beneficiario en Nicaragua/);
  assert.doesNotMatch(home, /Tarjeta de regalo electrónica/);
  assert.doesNotMatch(certificate, /Tarjeta de regalo electrónica/);
  assert.match(home, /class="footer-inner"/);
  assert.match(styles, /\.footer-inner\s*\{[^}]*margin-inline:\s*auto/s);
  assert.match(styles, /\.site-footer\s*\{[^}]*text-align:\s*center/s);
});

test("production registration and profile intake stay closed", () => {
  const config = read("cloudflare/portal/wrangler.jsonc");
  for (const flag of ["REGISTRATION_OPEN", "KYC_OPEN", "ADMIN_SETUP_OPEN"]) {
    assert.match(config, new RegExp(`"${flag}":\\s*"false"`));
  }
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
  assert.match(terms, /nombre comercial no cambia/i);
  assert.match(terms, /Banco Central de Nicaragua/);
  assert.doesNotMatch(terms, /<table/i);
});
