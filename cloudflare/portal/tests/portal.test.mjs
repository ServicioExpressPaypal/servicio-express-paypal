import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createOTP } from "@better-auth/utils/otp";
import CertificateModel from "../public/certificate.js";

const origin = "https://portal.example.test";
async function setup(open = true, overrides = {}) {
  const emails = [];
  const whatsapp = [];
  const assetRequests = [];
  const botTokens = new Set();
  let botChecks = 0;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: ".test-build/worker.js",
      compatibilityDate: "2026-09-24",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      r2Buckets: ["DOCUMENTS"],
      serviceBindings: {
        ASSETS: (request) => {
          assetRequests.push(new URL(request.url).pathname);
          return new Response("asset");
        },
      },
      bindings: {
        APP_URL: origin,
        BETTER_AUTH_SECRET: "test-only-secret-at-least-32-characters-long",
        ADMIN_EMAIL: "admin@example.test",
        REGISTRATION_OPEN: String(open),
        KYC_OPEN: String(open),
        EMAIL_PROVIDER: open ? "resend" : "disabled",
        EMAIL_FROM: "cuentas@example.test",
        RESEND_API_KEY: "test-only",
        WHATSAPP_PROVIDER: "meta",
        WHATSAPP_GRAPH_VERSION: "v23.0",
        WHATSAPP_TEMPLATE_NAME: "nuevo_ticket_saldo_express",
        WHATSAPP_TEMPLATE_LANGUAGE: "es",
        WHATSAPP_ACCESS_TOKEN: "whatsapp-test-only",
        WHATSAPP_PHONE_NUMBER_ID: "123456789",
        WHATSAPP_ADMIN_NUMBER: "50586199889",
        ADMIN_SETUP_OPEN: "false",
        TURNSTILE_ENABLED: "false",
        TURNSTILE_SECRET: "test-only-turnstile",
        ...overrides,
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.host === "challenges.cloudflare.com") {
          botChecks++;
          const data = new URLSearchParams(await request.text());
          const token = data.get("response");
          const [kind, action] = (token || "").split(":");
          const success = !botTokens.has(token) && kind !== "invalid";
          botTokens.add(token);
          return Response.json({
            success,
            hostname:
              kind === "wronghost" ? "evil.example" : new URL(origin).hostname,
            action,
          });
        }
        if (url.host === "api.resend.com") {
          emails.push(await request.json());
          return Response.json({ id: crypto.randomUUID() });
        }
        assert.equal(url.host, "graph.facebook.com");
        assert.equal(
          request.headers.get("authorization"),
          "Bearer whatsapp-test-only",
        );
        whatsapp.push(await request.json());
        return Response.json({ messages: [{ id: "wamid.test-ticket" }] });
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const name of [
    "0001_auth.sql",
    "0002_portal.sql",
    "0003_admin_setup.sql",
    "0004_ticket_chat.sql",
    "0005_ticket_destination.sql",
    "0006_account_notices.sql",
    "0007_ticket_whatsapp.sql",
    "0008_privacy_security.sql",
  ]) {
    const sql = await readFile("migrations/" + name, "utf8");
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  }
  let ip = 0;
  function client() {
    const jar = new Map(),
      address = `192.0.2.${++ip}`;
    return async (path, body, custom = {}) => {
      const request = new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "cf-connecting-ip": address,
          cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
          ...(body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...custom,
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      const response = await mf.dispatchFetch(origin + path, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: body === undefined ? undefined : await request.arrayBuffer(),
        redirect: "manual",
      });
      for (const c of response.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: response.status, data, headers: response.headers };
    };
  }
  async function registered(email) {
    const req = client(),
      password = "test-only-password-987654";
    let r = await req("/api/auth/sign-up/email", {
      email,
      password,
      name: "Test user",
      callbackURL: origin + "/",
      legalAccepted: true,
      legalVersion: CertificateModel.version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (let n = 0; n < 30 && !emails.some((e) => e.to.includes(email)); n++)
      await new Promise((r) => setTimeout(r, 20));
    const message = emails.find((e) => e.to.includes(email));
    assert.ok(message, "verification email dispatched");
    const url = new URL(message.text.match(/https:\/\/\S+/)[0]);
    r = await req(url.pathname + url.search);
    assert.ok([200, 302].includes(r.status), JSON.stringify(r.data));
    r = await req("/api/auth/sign-in/email", { email, password });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.headers.get("set-cookie"), /httponly/i);
    assert.match(r.headers.get("set-cookie"), /secure/i);
    const me = await req("/api/me");
    assert.equal(me.status, 200, JSON.stringify(me.data));
    assert.equal(
      me.data.profile.status,
      "pending",
      "consent automatically creates a pending account",
    );
    const consent = await db
      .prepare("SELECT * FROM registration_consents WHERE user_id=?")
      .bind(me.data.user.id)
      .first();
    assert.equal(consent.version, CertificateModel.version);
    return { req, id: me.data.user.id, password };
  }
  return {
    mf,
    db,
    emails,
    whatsapp,
    assetRequests,
    client,
    registered,
    get botChecks() {
      return botChecks;
    },
  };
}
function dossier() {
  return {
    declaration: "on",
    terms: "on",
    privacy: "on",
    version: CertificateModel.version,
  };
}
function ticket(overrides = {}) {
  return {
    amount: "164",
    beneficiaryName: "Beneficiario de Prueba",
    bank: "LAFISE",
    bankAccount: "000987654321",
    currency: "USD",
    consent: true,
    conditionsAccepted: true,
    conditionsVersion: CertificateModel.ticketConditionsVersion,
    requestKey: crypto.randomUUID(),
    ...overrides,
  };
}
test("certificate profile validates minimum data without accepting client-controlled verification", () => {
  const p = CertificateModel.validate(
    {
      ...dossier(),
      status: "active",
      acceptedAt: 0,
    },
    123,
  );
  assert.equal(p.name, undefined);
  assert.equal(p.cedula, undefined);
  assert.throws(
    () =>
      CertificateModel.validate({ ...dossier(), cedula: "dato-no-admitido" }),
    /no admite/,
  );
  assert.throws(
    () => CertificateModel.validate({ ...dossier(), version: "outdated" }),
    /aviso cambió/,
  );
  assert.equal(p.bankAccount, undefined);
  assert.equal(p.phone, undefined);
  assert.equal(p.acceptedAt, 123);
  assert.equal(p.status, undefined);
  assert.equal(p.front, undefined);
  for (const key of ["version", "declaration", "terms", "privacy"])
    assert.throws(
      () => CertificateModel.validate({ ...dossier(), [key]: "" }),
      key,
    );
  for (const key of [
    "name",
    "phone",
    "bank",
    "bankAccount",
    "currency",
    "cedula",
    "front",
    "back",
  ])
    assert.throws(() =>
      CertificateModel.validate({ ...dossier(), [key]: "dato" }),
    );
  assert.throws(() =>
    CertificateModel.validate({
      ...dossier(),
      bankAccount: { value: "123456" },
    }),
  );
});
test("ticket destination requires beneficiary, bank account and current conditions", () => {
  const accepted = CertificateModel.validateTicket(ticket(), 456);
  assert.equal(accepted.beneficiaryName, "Beneficiario de Prueba");
  assert.equal(accepted.bankAccount, "000987654321");
  assert.equal(accepted.termsVersion, CertificateModel.ticketConditionsVersion);
  assert.equal(accepted.termsAcceptedAt, 456);
  assert.throws(
    () =>
      CertificateModel.validateTicket(
        ticket({ bankAccount: "4111111111111111x" }),
      ),
    /número de cuenta/,
  );
  assert.throws(
    () =>
      CertificateModel.validateTicket(ticket({ conditionsAccepted: false })),
    /aceptar las condiciones/,
  );
  assert.throws(
    () =>
      CertificateModel.validateTicket(
        ticket({ conditionsVersion: "anterior" }),
      ),
    /cambiaron/,
  );
});
test("maintenance mode hides assets and blocks every API", async () => {
  const s = await setup(false, { MAINTENANCE_MODE: "true" });
  try {
    const req = s.client();
    assert.equal((await req("/")).status, 200);
    assert.equal(s.assetRequests.at(-1), "/index.html");
    assert.equal((await req("/app.js")).data, "asset");
    assert.equal((await req("/api/config")).status, 503);
    assert.equal((await req("/api/health")).status, 503);
    assert.equal((await req("/api/auth/sign-in/email", {})).status, 503);
  } finally {
    await s.mf.dispose();
  }
});
test("closed deployment rejects registration, anonymous access and cross-origin mutations", async () => {
  const s = await setup(false);
  try {
    const req = s.client();
    assert.equal((await req("/")).status, 200);
    assert.equal(s.assetRequests.at(-1), "/app-shell.html");
    assert.equal((await req("/api/health")).status, 200);
    assert.equal((await req("/api/config")).data.registrationOpen, false);
    assert.equal((await req("/api/auth/sign-up/email", {})).status, 503);
    assert.equal((await req("/api/setup/request", {})).status, 503);
    assert.equal((await req("/api/tickets")).status, 401);
    assert.equal((await req("/api/admin/users")).status, 401);
    assert.equal(
      (await req("/api/tickets", {}, { origin: "https://evil.example" }))
        .status,
      403,
    );
    assert.equal(
      (await req("/api/auth/update-user", { role: "admin" })).status,
      404,
    );
  } finally {
    await s.mf.dispose();
  }
});
test("owner invitation is private, expires, single-use and does not open customer registration", async () => {
  const s = await setup(false, {
    ADMIN_SETUP_OPEN: "true",
    EMAIL_PROVIDER: "resend",
  });
  try {
    const req = s.client();
    assert.equal((await req("/api/setup/request")).status, 405);
    assert.equal(
      (await req("/api/setup/request", {}, { origin: "https://evil.example" }))
        .status,
      403,
    );
    const requested = await req("/api/setup/request", {
      email: "attacker@example.test",
    });
    assert.deepEqual(requested.data, { ok: true });
    for (let n = 0; n < 30 && !s.emails.length; n++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.emails.length, 1);
    assert.deepEqual(s.emails[0].to, ["admin@example.test"]);
    const token = s.emails[0].text.match(/#invite=([a-f0-9]{64})/)[1];
    const row = await s.db.prepare("SELECT * FROM admin_setup").first();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.claimed_at, null);
    await s.client()("/api/setup/request", {});
    assert.equal(
      s.emails.length,
      1,
      "concurrent requests do not replace a valid invitation",
    );
    assert.equal(
      (
        await req("/api/auth/sign-up/email", {
          email: "admin@example.test",
          name: "Admin",
          password: "test-only-password",
        })
      ).status,
      503,
    );
    const body = {
      token,
      name: "Owner",
      password: "test-only-password-654321",
      email: "attacker@example.test",
      emailVerified: true,
      role: "admin",
    };
    assert.equal(
      (await req("/api/setup/complete", { ...body, token: "f".repeat(64) }))
        .status,
      410,
    );
    assert.equal(
      (await req("/api/setup/complete", { ...body, password: "short" })).status,
      400,
    );
    await s.db.prepare("UPDATE admin_setup SET expires_at=0").run();
    assert.equal((await s.client()("/api/setup/complete", body)).status, 410);
    await s.db
      .prepare("UPDATE admin_setup SET expires_at=?")
      .bind(Date.now() + 60000)
      .run();
    const results = await Promise.all([
      s.client()("/api/setup/complete", body),
      s.client()("/api/setup/complete", body),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 410]);
    const users = await s.db
      .prepare("SELECT email,emailVerified,twoFactorEnabled FROM user")
      .all();
    assert.equal(users.results.length, 1);
    assert.equal(users.results[0].email, "admin@example.test");
    assert.equal(users.results[0].emailVerified, 0);
    assert.ok(!users.results[0].twoFactorEnabled);
    assert.equal((await s.client()("/api/admin/users")).status, 401);
    assert.equal((await s.client()("/api/setup/complete", body)).status, 410);
    const count = s.emails.length;
    await s.client()("/api/setup/request", {});
    assert.equal(
      s.emails.length,
      count,
      "existing owner cannot be re-invited or replaced",
    );
    assert.equal((await req("/api/config")).data.registrationOpen, false);
    for (
      let n = 0;
      n < 30 && !s.emails.some((e) => e.subject === "Verifica tu correo");
      n++
    )
      await new Promise((r) => setTimeout(r, 20));
    const verification = s.emails.find(
      (e) => e.subject === "Verifica tu correo",
    );
    assert.ok(verification);
    const url = new URL(verification.text.match(/https:\/\/\S+/)[0]);
    const owner = s.client();
    assert.ok(
      [200, 302].includes((await owner(url.pathname + url.search)).status),
    );
    assert.equal(
      (
        await owner("/api/auth/sign-in/email", {
          email: "admin@example.test",
          password: body.password,
        })
      ).status,
      200,
    );
    const me = await owner("/api/me");
    assert.equal(me.data.admin, true);
    assert.equal(me.data.adminReady, false);
    assert.equal(
      (await owner("/api/admin/users")).status,
      403,
      "MFA remains required",
    );
  } finally {
    await s.mf.dispose();
  }
});
test("optional admin MFA preserves verified-owner authorization and KYC closure", async () => {
  const s = await setup(true, {
    ADMIN_REQUIRE_MFA: "false",
    KYC_OPEN: "false",
  });
  try {
    const anonymous = s.client();
    assert.equal((await anonymous("/api/admin/users")).status, 401);
    const owner = await s.registered("admin@example.test");
    const customer = await s.registered("customer@example.test");
    const me = await owner.req("/api/me");
    assert.equal(me.data.adminReady, true);
    assert.equal(me.data.twoFactorEnabled, false);
    assert.equal((await owner.req("/api/admin/users")).status, 200);
    assert.equal((await owner.req("/api/tickets")).status, 200);
    assert.equal((await customer.req("/api/me")).data.adminReady, false);
    assert.equal((await customer.req("/api/admin/users")).status, 403);
    assert.equal(
      (
        await customer.req("/api/admin/unlock", {
          adminReady: true,
          role: "admin",
        })
      ).status,
      403,
    );
    assert.equal((await customer.req("/api/profile", dossier())).status, 503);
    assert.equal(
      (await anonymous("/api/admin/users", { adminReady: true })).status,
      401,
    );
  } finally {
    await s.mf.dispose();
  }
});
test("verified auth, minimal profile, MFA admin, activation, persistent tickets, quotes and isolation", async () => {
  const s = await setup();
  try {
    const a = await s.registered("client-a@example.test"),
      b = await s.registered("client-b@example.test"),
      admin = await s.registered("admin@example.test");
    assert.equal((await a.req("/api/admin/users")).status, 403);
    assert.equal((await a.req("/api/tickets", { amount: "100" })).status, 403);
    // Exercise correction/legacy onboarding separately from automatic registration.
    await s.db
      .prepare(
        "UPDATE profiles SET status='incomplete',dossier=NULL WHERE user_id=?",
      )
      .bind(a.id)
      .run();
    assert.equal(
      (await a.req("/api/profile", { ...dossier(), front: "forbidden-photo" }))
        .status,
      400,
    );
    assert.equal(
      (
        await a.req("/api/profile", {
          ...dossier(),
          cedula: "dato-no-admitido",
        })
      ).status,
      400,
    );
    let r = await a.req("/api/profile", dossier());
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await a.req("/api/me")).data.profile.status, "pending");
    assert.equal((await a.req("/api/tickets", { amount: "100" })).status, 403);
    assert.equal((await a.req("/api/profile", dossier())).status, 409);
    assert.equal(
      (await (await s.mf.getR2Bucket("DOCUMENTS")).list()).objects.length,
      0,
    );
    assert.equal(
      (await a.req(`/api/admin/documents/${a.id}/front`)).status,
      403,
    );
    assert.equal((await admin.req("/api/admin/users")).status, 403);
    r = await admin.req("/api/auth/two-factor/enable", {
      password: admin.password,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // The authenticator URL contains a base32-encoded copy of the raw OTP secret.
    const secret = decodeBase32(
      new URL(r.data.totpURI).searchParams.get("secret"),
    );
    const code = await createOTP(secret).totp();
    r = await admin.req("/api/auth/two-factor/verify-totp", { code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await admin.req("/api/admin/users")).status, 403);
    r = await admin.req("/api/admin/unlock", { code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await admin.req(`/api/admin/users/${a.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.dossier.name, undefined);
    assert.equal(r.data.dossier.cedula, undefined);
    assert.equal(r.data.dossier.front, undefined);
    assert.equal(r.data.dossier.hasDocuments, false);
    assert.equal(r.data.dossier.bankAccount, undefined);
    assert.equal(r.data.dossier.version, CertificateModel.version);
    const version = r.data.version;
    r = await admin.req(`/api/admin/documents/${a.id}/front`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("cache-control"), "no-store");
    r = await admin.req(`/api/admin/users/${a.id}`, {
      action: "activate",
      reason: "Expediente ficticio verificado",
      version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (
      let n = 0;
      n < 30 &&
      !s.emails.some(
        (email) =>
          email.to.includes("client-a@example.test") &&
          email.subject.includes("Actualización"),
      );
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const activationNotice = s.emails.find(
      (email) =>
        email.to.includes("client-a@example.test") &&
        email.subject.includes("Actualización"),
    );
    assert.ok(activationNotice, "account activation notice dispatched");
    assert.match(activationNotice.text, /Expediente ficticio verificado/);
    assert.ok(!activationNotice.text.includes(ticket().bankAccount));
    const activationRow = await s.db
      .prepare(
        "SELECT status,reason,delivered FROM account_notices WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .bind(a.id)
      .first();
    assert.deepEqual(activationRow, {
      status: "active",
      reason: "Expediente ficticio verificado",
      delivered: 1,
    });
    const wrongDestination = await a.req(
      "/api/tickets",
      ticket({ bank: "Banco inexistente" }),
    );
    assert.equal(wrongDestination.status, 400);
    assert.equal(
      (
        await admin.req(`/api/admin/users/${a.id}`, {
          action: "suspend",
          reason: "Prueba de versión obsoleta",
          version,
        })
      ).status,
      409,
    );
    const requestKey = crypto.randomUUID();
    r = await a.req(
      "/api/tickets",
      ticket({
        mode: "international",
        requestKey,
        estimate: { net: 999999 },
        user_id: b.id,
        status: "closed",
      }),
    );
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = r.data.id;
    for (let n = 0; n < 30 && !s.whatsapp.length; n++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(s.whatsapp.length, 1, "WhatsApp ticket notice dispatched");
    const whatsappNotice = s.whatsapp[0];
    assert.equal(whatsappNotice.to, "50586199889");
    assert.equal(whatsappNotice.type, "template");
    assert.equal(whatsappNotice.template.name, "nuevo_ticket_saldo_express");
    const whatsappText = JSON.stringify(whatsappNotice);
    assert.match(whatsappText, new RegExp(id));
    assert.match(whatsappText, /USD 164\.00/);
    assert.match(whatsappText, /USD 145\.00/);
    assert.match(whatsappText, /Certificado en efectivo/);
    assert.ok(!whatsappText.includes(ticket().bankAccount));
    assert.ok(!whatsappText.includes(ticket().beneficiaryName));
    const whatsappRow = await s.db
      .prepare(
        "SELECT whatsapp_delivered,whatsapp_attempts,whatsapp_message_id FROM notifications WHERE ticket_id=?",
      )
      .bind(id)
      .first();
    assert.deepEqual(whatsappRow, {
      whatsapp_delivered: 1,
      whatsapp_attempts: 0,
      whatsapp_message_id: "wamid.test-ticket",
    });
    const persisted = await a.req("/api/tickets/" + id);
    assert.equal(persisted.data.status, "submitted");
    assert.equal(persisted.data.user_id, a.id);
    assert.equal(persisted.data.mode, "express");
    assert.equal(persisted.data.estimate.amount, 16400);
    assert.equal(persisted.data.estimate.net, 14500);
    assert.equal(persisted.data.beneficiary_name, "Beneficiario de Prueba");
    assert.equal(persisted.data.bank_account, "000987654321");
    assert.equal(
      persisted.data.terms_version,
      CertificateModel.ticketConditionsVersion,
    );
    assert.ok(
      persisted.data.terms_accepted_at >= persisted.data.created_at - 1000,
    );
    assert.equal(
      persisted.data.expires_at - persisted.data.created_at,
      24 * 60 * 60 * 1000,
    );
    assert.equal(persisted.data.expired, false);
    assert.equal(persisted.data.canMessage, true);
    assert.notEqual(persisted.data.estimate.net, 999999);
    const ticketList = await a.req("/api/tickets");
    assert.equal(ticketList.data[0].bank_account, undefined);
    assert.equal((await b.req("/api/tickets/" + id)).status, 404);
    assert.equal(
      (await b.req("/api/tickets/" + id, { action: "cancelled", version: 0 }))
        .status,
      404,
    );
    assert.equal((await b.req("/api/tickets")).data.length, 0);
    r = await a.req(`/api/tickets/${id}/messages`, {
      message: "  Necesito confirmar el banco del beneficiario.  ",
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.body, "Necesito confirmar el banco del beneficiario.");
    assert.equal(r.data.author_role, "customer");
    assert.equal(
      (
        await b.req(`/api/tickets/${id}/messages`, {
          message: "No debo poder escribir aquí",
        })
      ).status,
      404,
    );
    r = await admin.req(`/api/admin/tickets/${id}/messages`, {
      message: "El banco fue confirmado. Continúa por el WhatsApp oficial.",
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.author_role, "admin");
    const conversation = await a.req("/api/tickets/" + id);
    assert.deepEqual(
      conversation.data.messages.map((message) => message.author_role),
      ["customer", "admin"],
    );
    assert.equal(conversation.data.messages[0].author_id, undefined);
    const messageAudit = await s.db
      .prepare("SELECT action,detail FROM audit_events WHERE target_id=?")
      .bind(id)
      .all();
    assert.ok(!JSON.stringify(messageAudit).includes("confirmar el banco"));
    assert.equal(
      (
        await a.req(`/api/tickets/${id}/messages`, {
          message: "x".repeat(1001),
        })
      ).status,
      400,
    );
    r = await a.req("/api/tickets", ticket({ requestKey }));
    assert.equal(r.data.id, id);
    assert.equal((await a.req("/api/tickets")).data.length, 1);
    r = await a.req("/api/tickets", ticket({ amount: "600", mode: "express" }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const internationalId = r.data.id;
    const international = await a.req("/api/tickets/" + internationalId);
    await a.req(`/api/tickets/${internationalId}/messages`, {
      message: "Datos privados de prueba",
    });
    assert.equal(international.data.mode, "international");
    assert.equal(international.data.estimate.amount, 60000);
    assert.equal((await a.req("/api/tickets")).data.length, 2);
    await s.db
      .prepare("UPDATE tickets SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, internationalId)
      .run();
    const expired = await a.req("/api/tickets/" + internationalId);
    assert.equal(expired.data.status, "expired");
    assert.equal(expired.data.expired, true);
    assert.equal(expired.data.canMessage, false);
    assert.equal(expired.data.beneficiary_name, "");
    assert.equal(expired.data.bank_account, "");
    assert.equal(expired.data.bank, "");
    assert.deepEqual(expired.data.messages, []);
    const erased = await s.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .bind(internationalId)
      .first();
    assert.equal(erased.bank_account, "");
    assert.equal(erased.beneficiary_name, "");
    assert.ok(erased.data_erased_at);
    assert.equal(erased.amount, 60000);
    assert.equal(
      erased.terms_version,
      CertificateModel.ticketConditionsVersion,
    );
    assert.equal(
      (
        await s.db
          .prepare("SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id=?")
          .bind(internationalId)
          .first()
      ).n,
      0,
    );
    const adminHistory = await admin.req(
      `/api/admin/tickets/${internationalId}`,
    );
    assert.equal(adminHistory.data.bank_account, "");
    assert.deepEqual(adminHistory.data.messages, []);
    assert.equal(
      (
        await a.req(`/api/tickets/${internationalId}/messages`, {
          message: "Mensaje fuera de tiempo",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await admin.req(`/api/admin/tickets/${internationalId}`, {
          action: "reviewing",
          version: 0,
        })
      ).status,
      409,
    );
    r = await admin.req("/api/admin/tickets/" + id, {
      action: "reviewing",
      version: 0,
    });
    assert.equal(r.status, 200);
    assert.equal(
      (
        await admin.req("/api/admin/tickets/" + id, {
          action: "quoted",
          version: 1,
        })
      ).status,
      400,
    );
    r = await admin.req("/api/admin/tickets/" + id, {
      action: "quote",
      version: 1,
      quote: { received: "150", fee: "14", rate: 1, hours: 24, validity: 60 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(
      (await a.req("/api/tickets/" + id)).data.quote.received,
      15000,
    );
    const quoted = await a.req("/api/tickets/" + id);
    assert.ok(quoted.data.quote.expiresAt <= quoted.data.expires_at);
    assert.equal(
      (await a.req("/api/tickets/" + id, { action: "cancelled", version: 2 }))
        .status,
      409,
    );
    r = await admin.req(`/api/admin/users/${a.id}`, {
      action: "suspend",
      reason: "Prueba de suspensión",
      version: version + 1,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(
      (
        await a.req("/api/tickets", {
          amount: "100",
          mode: "express",
          bank: "BAC",
          currency: "USD",
          consent: true,
          requestKey: crypto.randomUUID(),
        })
      ).status,
      403,
    );
    r = await admin.req(`/api/admin/users/${a.id}`, {
      action: "close",
      reason: "Cierre administrativo de prueba",
      version: version + 2,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const closedAccount = await admin.req(`/api/admin/users/${a.id}`);
    assert.equal(closedAccount.data.status, "closed");
    assert.equal(closedAccount.data.notices.length, 3);
    assert.equal(closedAccount.data.notices[0].status, "closed");
    assert.equal(
      (
        await admin.req(`/api/admin/users/${a.id}`, {
          action: "reactivate",
          reason: "No debe reabrirse",
          version: version + 3,
        })
      ).status,
      400,
    );
    const counts = await s.db
      .prepare("SELECT count(*) AS n FROM tickets")
      .first();
    assert.equal(counts.n, 2);
    await s.db.prepare("UPDATE admin_grants SET expires_at=0").run();
    assert.equal((await admin.req("/api/admin/users")).status, 403);
    assert.equal(
      (await admin.req(`/api/admin/documents/${a.id}/front`)).status,
      403,
    );
  } finally {
    await s.mf.dispose();
  }
});
test("correction requires fresh approval, preserves legacy files and cannot activate unverified users", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("correction@example.test");
    const bucket = await s.mf.getR2Bucket("DOCUMENTS");
    await bucket.put("legacy/front", "fictional legacy document");
    await s.db
      .prepare(
        "UPDATE profiles SET dossier=?,status='correction' WHERE user_id=?",
      )
      .bind(JSON.stringify({ front: "legacy/front" }), customer.id)
      .run();
    assert.equal(
      (
        await customer.req("/api/profile", {
          ...dossier(),
          status: "active",
          acceptedAt: 0,
        })
      ).status,
      200,
    );
    let row = await s.db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(customer.id)
      .first();
    assert.equal(row.status, "pending");
    assert.equal(JSON.parse(row.dossier).front, "legacy/front");
    assert.ok(JSON.parse(row.dossier).acceptedAt > 0);
    assert.ok(await bucket.get("legacy/front"));
    const loaded = await admin.req(`/api/admin/users/${customer.id}`);
    assert.equal(loaded.data.dossier.hasDocuments, true);
    assert.equal(loaded.data.dossier.front, undefined);
    await s.db
      .prepare("UPDATE user SET emailVerified=0 WHERE id=?")
      .bind(customer.id)
      .run();
    assert.equal(
      (
        await admin.req(`/api/admin/users/${customer.id}`, {
          action: "activate",
          reason: "Revisión ficticia",
          version: row.version,
        })
      ).status,
      400,
    );
    await s.db
      .prepare("UPDATE user SET emailVerified=1 WHERE id=?")
      .bind(customer.id)
      .run();
    assert.equal(
      (
        await admin.req(`/api/admin/users/${customer.id}`, {
          action: "correct",
          reason: "Corregir cuenta de prueba",
          version: row.version,
        })
      ).status,
      200,
    );
    assert.equal((await customer.req("/api/profile", dossier())).status, 200);
    row = await s.db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(customer.id)
      .first();
    assert.equal(row.status, "pending");
    assert.equal(JSON.parse(row.dossier).bank, undefined);
    assert.equal(
      (await customer.req("/api/tickets", { amount: "100" })).status,
      403,
    );
    const events = await s.db
      .prepare("SELECT detail FROM audit_events WHERE target_id=?")
      .bind(customer.id)
      .all();
    assert.ok(!JSON.stringify(events).includes("cedula"));
    assert.ok(!JSON.stringify(events).includes(ticket().bankAccount));
  } finally {
    await s.mf.dispose();
  }
});
test("unverified accounts cannot log in; passwords hashed; auth input and rate limits enforced", async () => {
  const s = await setup();
  try {
    const req = s.client();
    const body = {
      email: "unverified@example.test",
      password: "test-only-password-987654",
      name: "Test",
      twoFactorEnabled: true,
      role: "admin",
      legalAccepted: true,
      legalVersion: CertificateModel.version,
    };
    assert.equal((await req("/api/auth/sign-up/email", body)).status, 200);
    assert.equal((await req("/api/me")).status, 401);
    assert.equal((await req("/api/auth/sign-in/email", body)).status, 403);
    const user = await s.db
      .prepare("SELECT * FROM user WHERE email=?")
      .bind(body.email)
      .first();
    assert.equal(user.emailVerified, 0);
    assert.equal(user.name, "Cliente");
    assert.equal(user.twoFactorEnabled, 0);
    const account = await s.db
      .prepare("SELECT password FROM account WHERE userId=?")
      .bind(user.id)
      .first();
    assert.notEqual(account.password, body.password);
    assert.ok(account.password.length > 50);
    assert.equal(
      (
        await req("/api/auth/sign-in/email", {
          email: body.email,
          password: "x".repeat(17000),
        })
      ).status,
      413,
    );
    let last;
    for (let n = 0; n < 8; n++)
      last = await req("/api/auth/sign-in/email", {
        email: body.email,
        password: "bad-password",
      });
    assert.equal(last.status, 429);
  } finally {
    await s.mf.dispose();
  }
});
test("Turnstile rejects absent, invalid, wrong-host, wrong-action and reused tokens before authentication", async () => {
  const s = await setup(true, { TURNSTILE_ENABLED: "true" });
  try {
    const path = "/api/auth/sign-up/email";
    const body = {
      email: "bot@example.test",
      password: "test-only-password-987654",
      legalAccepted: true,
      legalVersion: CertificateModel.version,
    };
    for (const token of [
      undefined,
      "invalid:signup",
      "wronghost:signup",
      "valid:login",
    ])
      assert.equal(
        (await s.client()(path, { ...body, turnstileToken: token })).status,
        403,
      );
    assert.equal(
      (await s.db.prepare("SELECT COUNT(*) n FROM user").first()).n,
      0,
    );
    assert.equal(s.emails.length, 0);
    const token = "valid:signup:" + crypto.randomUUID();
    // A valid challenge reaches consent validation without creating a user.
    assert.equal(
      (
        await s.client()(path, {
          ...body,
          legalAccepted: false,
          turnstileToken: token,
        })
      ).status,
      400,
    );
    assert.equal(
      (await s.client()(path, { ...body, turnstileToken: token })).status,
      403,
    );
    assert.equal(
      (
        await s.client()(path, {
          ...body,
          turnstileToken: "valid:signup:" + crypto.randomUUID(),
        })
      ).status,
      200,
    );
    const profile = await s.db.prepare("SELECT * FROM profiles").first();
    assert.equal(
      profile.status,
      "pending",
      "visible to admin before first login",
    );
    assert.equal(profile.full_name, "");
    assert.equal(JSON.parse(profile.dossier).bankAccount, undefined);
  } finally {
    await s.mf.dispose();
  }
});
test("three attempts block only that IP, including concurrent requests and spoofed forwarding headers", async () => {
  const s = await setup(true, { TURNSTILE_ENABLED: "true" });
  try {
    const req = s.client();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        req("/api/auth/sign-in/email", {
          email: "none@example.test",
          password: "incorrect-password",
          turnstileToken: "invalid:login",
        }),
      ),
    );
    assert.deepEqual(
      attempts.map((r) => r.status).sort(),
      [403, 403, 403, 429, 429, 429],
    );
    assert.equal(
      s.botChecks,
      3,
      "blocked IP cannot keep consuming verification calls",
    );
    const blocked = await req(
      "/api/auth/request-password-reset",
      { email: "none@example.test" },
      { "x-forwarded-for": "198.51.100.77" },
    );
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "900");
    assert.equal((await s.client()("/api/auth/sign-in/email", {})).status, 403);
    const rows = await s.db
      .prepare("SELECT key,count FROM request_limits")
      .all();
    assert.ok(rows.results.every((r) => !r.key.includes("192.0.2.")));
    await s.db.prepare("UPDATE request_limits SET expires_at=0").run();
    assert.equal((await req("/api/auth/sign-in/email", {})).status, 403);
    assert.equal(s.emails.length, 0);
  } finally {
    await s.mf.dispose();
  }
});
test("successful login resets failures; cancelling purges destination and chat but retains consent", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const a = await s.registered("retention@example.test");
    assert.equal(
      (
        await a.req("/api/auth/sign-in/email", {
          email: "retention@example.test",
          password: "wrong-password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await a.req("/api/auth/sign-in/email", {
          email: "retention@example.test",
          password: a.password,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await s.db
          .prepare(
            "SELECT count(*) n FROM request_limits WHERE key LIKE 'auth-ip:%'",
          )
          .first()
      ).n,
      0,
    );
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(a.id)
      .run();
    const created = await a.req("/api/tickets", ticket());
    const id = created.data.id;
    assert.equal(created.status, 201);
    await a.req(`/api/tickets/${id}/messages`, { message: "Temporal" });
    assert.equal(
      (await a.req(`/api/tickets/${id}`, { action: "cancelled", version: 0 }))
        .status,
      200,
    );
    const row = await s.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .bind(id)
      .first();
    assert.equal(row.beneficiary_name, "");
    assert.equal(row.bank_account, "");
    assert.ok(row.data_erased_at);
    assert.equal(row.terms_version, CertificateModel.ticketConditionsVersion);
    assert.equal(
      (
        await s.db
          .prepare("SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id=?")
          .bind(id)
          .first()
      ).n,
      0,
    );
    assert.equal(
      (await a.req(`/api/tickets/${id}`)).data.destinationErased,
      true,
    );
  } finally {
    await s.mf.dispose();
  }
});
function decodeBase32(input) {
  let bits = "";
  for (const c of input.replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const bytes = [];
  for (let n = 0; n + 8 <= bits.length; n += 8)
    bytes.push(parseInt(bits.slice(n, n + 8), 2));
  return Buffer.from(bytes).toString();
}
