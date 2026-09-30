// Isolated, in-memory preview. Never loads production credentials or sends mail.
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import CertificateModel from "../public/certificate.js";
import "../../../calculator-core.js";

const port = Number(process.env.PORT || 8792);
const origin = `http://127.0.0.1:${port}`;
const assets = new Set([
  "index.html",
  "app-shell.html",
  "app.js",
  "qrcode.js",
  "app.css",
  "certificate.js",
  "processing.js",
  "accounts.js",
  "portal.css",
  "lucide.min.js",
  "calculator-core.js",
  "logo.jpg",
  "gift-ribbon.png",
  "privacidad.html",
  "terminos.html",
  "legal.css",
]);
const types = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  jpg: "image/jpeg",
  png: "image/png",
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    port,
    modules: true,
    scriptPath: ".test-build/worker.js",
    compatibilityDate: "2026-09-24",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["DOCUMENTS"],
    bindings: {
      APP_URL: origin,
      BETTER_AUTH_SECRET: "local-preview-only-not-a-production-secret",
      ADMIN_EMAIL: "admin@example.test",
      ADMIN_REQUIRE_MFA:
        process.env.PREVIEW_REQUIRE_MFA === "true" ? "true" : "false",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      REGISTRATION_OPEN: "true",
      TURNSTILE_ENABLED: "false",
      KYC_OPEN: "true",
      ADMIN_SETUP_OPEN: "false",
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "preview@example.test",
      RESEND_API_KEY: "local-only",
      WHATSAPP_PROVIDER: "disabled",
    },
    serviceBindings: {
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        const name = path === "/" ? "app-shell.html" : path.slice(1);
        if (!assets.has(name))
          return new Response("Not found", { status: 404 });
        return new Response(
          await readFile(new URL(`../dist/${name}`, import.meta.url)),
          {
            headers: {
              "content-type": types[name.split(".").pop()],
              "cache-control": "no-store",
            },
          },
        );
      },
    },
    outboundService: () => Response.json({ id: "local-email-discarded" }),
  }),
);
const db = await mf.getD1Database("DB");
for (const file of [
  "0001_auth.sql",
  "0002_portal.sql",
  "0003_admin_setup.sql",
  "0004_ticket_chat.sql",
  "0005_ticket_destination.sql",
  "0006_account_notices.sql",
  "0007_ticket_whatsapp.sql",
  "0008_privacy_security.sql",
  "0009_ticket_processing.sql",
  "0010_account_deletion.sql",
  "0011_ticket_delivery_amount.sql",
  "0012_security_events.sql",
]) {
  const sql = await readFile(
    new URL(`../migrations/${file}`, import.meta.url),
    "utf8",
  );
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
}
for (const [email, name] of [
  ["cliente@example.test", "Cliente de Prueba"],
  ["admin@example.test", "Administrador de Prueba"],
  ["pendiente@example.test", "Usuario Pendiente"],
]) {
  const response = await mf.dispatchFetch(origin + "/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.10",
    },
    body: JSON.stringify({
      email,
      name,
      password: "SoloPruebas-2026!",
      callbackURL: origin + "/",
      legalAccepted: true,
      legalVersion: CertificateModel.version,
      fullName: "Cliente de Prueba",
      phone: "+12025550123",
      paypalOwnership: true,
    }),
  });
  if (!response.ok)
    throw new Error(`Unable to seed preview account: ${response.status}`);
  await db
    .prepare("UPDATE user SET emailVerified=1 WHERE email=?")
    .bind(email)
    .run();
}
const customer = await db
    .prepare("SELECT id FROM user WHERE email='cliente@example.test'")
    .first(),
  admin = await db
    .prepare("SELECT id FROM user WHERE email='admin@example.test'")
    .first(),
  pending = await db
    .prepare("SELECT id FROM user WHERE email='pendiente@example.test'")
    .first(),
  ticketId = "SE-11111111-1111-4111-8111-111111111111",
  now = Date.now(),
  estimate = {
    version: "site-2026-09-23",
    amount: 16400,
    mode: "express",
    paypal: 916,
    delivery: 492,
    service: 492,
    total: 1900,
    net: 14500,
    currency: "USD",
  };
await db.batch([
  db
    .prepare(
      "INSERT INTO profiles(user_id,status,full_name,dossier,updated_at) VALUES(?,'pending',?,?,?) ON CONFLICT(user_id) DO UPDATE SET status='pending',full_name=excluded.full_name,dossier=excluded.dossier,updated_at=excluded.updated_at",
    )
    .bind(
      pending.id,
      "Usuario Pendiente",
      JSON.stringify({
        kind: "review-account",
        phone: "+12025550123",
        paypalOwnership: true,
        version: CertificateModel.version,
        acceptedAt: now,
      }),
      now,
    ),
  db
    .prepare(
      "INSERT INTO profiles(user_id,status,full_name,dossier,updated_at) VALUES(?,'active',?,?,?) ON CONFLICT(user_id) DO UPDATE SET status='active',full_name=excluded.full_name,dossier=excluded.dossier,updated_at=excluded.updated_at",
    )
    .bind(
      customer.id,
      "Cliente de Prueba",
      JSON.stringify({
        kind: "review-account",
        phone: "+12025550123",
        paypalOwnership: true,
        version: CertificateModel.version,
        acceptedAt: now,
      }),
      now,
    ),
  db
    .prepare(
      "INSERT INTO tickets(id,user_id,request_key,amount,mode,beneficiary_name,bank,bank_account,currency,terms_version,terms_accepted_at,estimate,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'reviewing',?,?,?)",
    )
    .bind(
      ticketId,
      customer.id,
      crypto.randomUUID(),
      estimate.amount,
      estimate.mode,
      "Familiar de Prueba",
      "LAFISE",
      "000123456789",
      "USD",
      CertificateModel.ticketConditionsVersion,
      now,
      JSON.stringify(estimate),
      now,
      now,
      now + 86400000,
    ),
  db
    .prepare(
      "INSERT INTO ticket_messages(id,ticket_id,author_id,author_role,body,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      ticketId,
      customer.id,
      "customer",
      "¿Puedo confirmar aquí el banco del beneficiario?",
      now + 1000,
    ),
  db
    .prepare(
      "INSERT INTO ticket_messages(id,ticket_id,author_id,author_role,body,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      ticketId,
      admin.id,
      "admin",
      "Sí. Cuando todo esté revisado, continuaremos la compra por WhatsApp.",
      now + 2000,
    ),
  db
    .prepare(
      "INSERT INTO audit_events(id,actor_id,target_id,action,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), customer.id, ticketId, "submitted", now),
]);
const internationalEstimate = globalThis.SaldoCalculator.estimate(
  60000,
  "international",
);
await db
  .prepare(
    "INSERT INTO tickets(id,user_id,request_key,amount,mode,beneficiary_name,bank,bank_account,currency,terms_version,terms_accepted_at,estimate,status,created_at,updated_at,expires_at) SELECT ?,user_id,?,60000,'international',beneficiary_name,bank,bank_account,currency,terms_version,terms_accepted_at,?,'reviewing',created_at,updated_at,expires_at FROM tickets WHERE id=?",
  )
  .bind(
    "SE-22222222-2222-4222-8222-222222222222",
    crypto.randomUUID(),
    JSON.stringify(internationalEstimate),
    ticketId,
  )
  .run();
console.log(`Vista local con datos ficticios: ${await mf.ready}`);
console.log(
  "Cliente: cliente@example.test | Pendiente: pendiente@example.test | Administrador: admin@example.test",
);
console.log("Clave exclusiva de esta prueba local: SoloPruebas-2026!");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
