import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createOTP } from "@better-auth/utils/otp";

const origin = "https://portal.example.test";
async function setup(open = true, overrides = {}) {
  const emails = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: ".test-build/worker.js",
      compatibilityDate: "2026-09-24",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      r2Buckets: ["DOCUMENTS"],
      serviceBindings: { ASSETS: () => new Response("asset") },
      bindings: {
        APP_URL: origin,
        BETTER_AUTH_SECRET: "test-only-secret-at-least-32-characters-long",
        ADMIN_EMAIL: "admin@example.test",
        REGISTRATION_OPEN: String(open),
        KYC_OPEN: String(open),
        EMAIL_PROVIDER: open ? "resend" : "disabled",
        EMAIL_FROM: "cuentas@example.test",
        RESEND_API_KEY: "test-only",
        ADMIN_SETUP_OPEN: "false",
        ...overrides,
      },
      outboundService: async (request) => {
        assert.equal(new URL(request.url).host, "api.resend.com");
        emails.push(await request.json());
        return Response.json({ id: crypto.randomUUID() });
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const name of [
    "0001_auth.sql",
    "0002_portal.sql",
    "0003_admin_setup.sql",
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
    return { req, id: me.data.user.id, password };
  }
  return { mf, db, emails, client, registered };
}
function dossier() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    name: "Persona de Prueba",
    cedula: "0010101900001A",
    source: "Salario",
    detail: "Ingresos ficticios para pruebas locales.",
    declaration: "on",
    terms: "on",
    privacy: "on",
  }))
    form.set(key, value);
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wSIAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  for (const side of ["front", "back"])
    form.set(side, new Blob([png], { type: "image/png" }), "fictional.png");
  return form;
}
test("closed deployment rejects registration, anonymous access and cross-origin mutations", async () => {
  const s = await setup(false);
  try {
    const req = s.client();
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
test("verified auth, private KYC, MFA admin, activation, persistent tickets, quotes and isolation", async () => {
  const s = await setup();
  try {
    const a = await s.registered("client-a@example.test"),
      b = await s.registered("client-b@example.test"),
      admin = await s.registered("admin@example.test");
    assert.equal((await a.req("/api/admin/users")).status, 403);
    assert.equal((await a.req("/api/tickets", { amount: "100" })).status, 403);
    let r = await a.req("/api/profile", dossier());
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await a.req("/api/me")).data.profile.status, "pending");
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
    assert.equal(r.data.dossier.name, "Persona de Prueba");
    assert.equal(r.data.dossier.front, undefined);
    const version = r.data.version;
    r = await admin.req(`/api/admin/documents/${a.id}/front`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    r = await admin.req(`/api/admin/users/${a.id}`, {
      action: "activate",
      reason: "Expediente ficticio verificado",
      version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
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
    r = await a.req("/api/tickets", {
      amount: "164",
      mode: "express",
      bank: "LAFISE",
      currency: "USD",
      consent: true,
      requestKey,
      estimate: { net: 999999 },
      user_id: b.id,
      status: "closed",
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = r.data.id;
    const persisted = await a.req("/api/tickets/" + id);
    assert.equal(persisted.data.status, "submitted");
    assert.equal(persisted.data.user_id, a.id);
    assert.notEqual(persisted.data.estimate.net, 999999);
    assert.equal((await b.req("/api/tickets/" + id)).status, 404);
    assert.equal(
      (await b.req("/api/tickets/" + id, { action: "cancelled", version: 0 }))
        .status,
      404,
    );
    assert.equal((await b.req("/api/tickets")).data.length, 0);
    r = await a.req("/api/tickets", {
      amount: "164",
      mode: "express",
      bank: "LAFISE",
      currency: "USD",
      consent: true,
      requestKey,
    });
    assert.equal(r.data.id, id);
    assert.equal((await a.req("/api/tickets")).data.length, 1);
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
    assert.equal(
      (await a.req("/api/tickets/" + id, { action: "cancelled", version: 2 }))
        .status,
      409,
    );
    await admin.req(`/api/admin/users/${a.id}`, {
      action: "suspend",
      reason: "Prueba de suspensión",
      version: version + 1,
    });
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
    const counts = await s.db
      .prepare("SELECT count(*) AS n FROM tickets")
      .first();
    assert.equal(counts.n, 1);
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
    };
    assert.equal((await req("/api/auth/sign-up/email", body)).status, 200);
    assert.equal((await req("/api/me")).status, 401);
    assert.equal((await req("/api/auth/sign-in/email", body)).status, 403);
    const user = await s.db
      .prepare("SELECT * FROM user WHERE email=?")
      .bind(body.email)
      .first();
    assert.equal(user.emailVerified, 0);
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
