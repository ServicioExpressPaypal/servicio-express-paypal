import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createOTP } from "@better-auth/utils/otp";
import CertificateModel from "../public/certificate.js";
import {
  encryptField,
  decryptField,
  encryptLegacyData,
} from "../src/encryption.ts";
import {
  addBusinessDays,
  processingWindow,
  ticketShareText,
  ticketStage,
  deliveryAmount,
  ticketExpiry,
} from "../public/processing.js";

const origin = "https://portal.example.test";
const encryptionEnv = {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

test("scheduled security alerts aggregate counts, rate-limit mail and expire old events", async () => {
  const s = await setup();
  try {
    const now = Date.now();
    await s.db
      .prepare(
        "INSERT INTO security_events VALUES('old','auth_failed','oldhash',?)",
      )
      .bind(now - 31 * 86400000)
      .run();
    for (let i = 0; i < 5; i++)
      await s.db
        .prepare("INSERT INTO security_events VALUES(?,'server_error','',?)")
        .bind(`event-${i}`, now)
        .run();
    const worker = await s.mf.getWorker();
    assert.equal(
      (await worker.scheduled({ cron: "*/15 * * * *" })).outcome,
      "ok",
    );
    assert.equal(
      await s.db
        .prepare("SELECT id FROM security_events WHERE id='old'")
        .first(),
      null,
    );
    for (let i = 0; i < 30 && s.emails.length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.emails.length, 1);
    assert.match(s.emails[0].subject, /Alerta de seguridad/);
    assert.match(s.emails[0].text, /server_error: 5/);
    assert.ok(!s.emails[0].text.includes("oldhash"));
    await worker.scheduled({ cron: "*/15 * * * *" });
    assert.equal(s.emails.length, 1);
    await s.db.prepare("UPDATE security_alerts SET next_at=0").run();
    await worker.scheduled({ cron: "*/15 * * * *" });
    for (let i = 0; i < 30 && s.emails.length < 2; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.emails.length, 2);
  } finally {
    await s.mf.dispose();
  }
});

test("field encryption uses random authenticated ciphertext bound to record and field", async () => {
  const first = await encryptField(
    encryptionEnv,
    "sensitive test data",
    "profile:one:name",
  );
  const second = await encryptField(
    encryptionEnv,
    "sensitive test data",
    "profile:one:name",
  );
  assert.notEqual(first, second);
  assert.ok(!first.includes("sensitive"));
  assert.equal(
    await decryptField(encryptionEnv, first, "profile:one:name"),
    "sensitive test data",
  );
  await assert.rejects(decryptField(encryptionEnv, first, "profile:two:name"));
  const altered = Buffer.from(first.slice(7), "base64");
  altered[15] ^= 1;
  await assert.rejects(
    decryptField(
      encryptionEnv,
      "enc:v1:" + altered.toString("base64"),
      "profile:one:name",
    ),
  );
  await assert.rejects(
    encryptField({ DATA_ENCRYPTION_KEY: "" }, "data", "context"),
  );
  assert.equal(
    await decryptField(encryptionEnv, "legacy", "context"),
    "legacy",
  );
});

test("HTTP redirects safely and HTTPS errors retain security headers", async () => {
  const s = await setup(false);
  try {
    const redirect = await s.mf.dispatchFetch(
      "http://portal.example.test/api/config?test=1",
      { redirect: "manual" },
    );
    assert.equal(redirect.status, 308);
    assert.equal(
      redirect.headers.get("location"),
      origin + "/api/config?test=1",
    );
    const unauthorized = await s.client()("/api/admin/users");
    assert.equal(unauthorized.status, 401);
    assert.match(
      unauthorized.headers.get("strict-transport-security"),
      /max-age=15552000/,
    );
    assert.equal(unauthorized.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      unauthorized.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.deepEqual((await s.client()("/api/health")).data, { ok: true });
  } finally {
    await s.mf.dispose();
  }
});

test("account limit blocks distributed login attempts without exposing identifiers", async () => {
  const s = await setup();
  try {
    const user = await s.registered("target@example.test");
    for (let i = 0; i < 5; i++) {
      const result = await s.client()("/api/auth/sign-in/email", {
        email: "target@example.test",
        password: "incorrect-test-password",
      });
      assert.equal(result.status, 401);
    }
    const blocked = await s.client()("/api/auth/sign-in/email", {
      email: "TARGET@example.test",
      password: user.password,
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    const rows = await s.db.prepare("SELECT * FROM request_limits").all();
    assert.ok(!JSON.stringify(rows).includes("target@example.test"));
    assert.ok(!JSON.stringify(rows).includes("192.0.2."));
    await s.db.prepare("DELETE FROM request_limits").run();
    assert.equal(
      (
        await s.client()("/api/auth/sign-in/email", {
          email: "target@example.test",
          password: user.password,
        })
      ).status,
      200,
    );
    for (let i = 0; i < 30; i++) {
      const events = await s.db.prepare("SELECT * FROM security_events").all();
      if (events.results.some((e) => e.event === "account_locked")) {
        assert.ok(!JSON.stringify(events).includes("target@example.test"));
        assert.ok(
          events.results
            .filter((e) => e.subject_hash)
            .every((e) => /^[a-f0-9]{64}$/.test(e.subject_hash)),
        );
        break;
      }
      if (i === 29) assert.fail("Security event was not persisted");
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    await s.mf.dispose();
  }
});

test("encrypted profiles, tickets and chat stay usable; legacy migration is idempotent", async () => {
  const s = await setup();
  try {
    const u = await s.registered("encrypted@example.test");
    const profile = await s.db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(u.id)
      .first();
    assert.match(profile.full_name, /^enc:v1:/);
    assert.match(JSON.parse(profile.dossier).phone, /^enc:v1:/);
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(u.id)
      .run();
    const created = await u.req("/api/tickets", ticket());
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal(
      (
        await u.req(`/api/tickets/${id}/messages`, {
          message: "Comentario de prueba",
        })
      ).status,
      201,
    );
    const raw = await s.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .bind(id)
      .first();
    assert.match(raw.beneficiary_name, /^enc:v1:/);
    assert.match(raw.bank_account, /^enc:v1:/);
    const message = await s.db
      .prepare("SELECT * FROM ticket_messages WHERE ticket_id=?")
      .bind(id)
      .first();
    assert.match(message.body, /^enc:v1:/);
    const detail = (await u.req(`/api/tickets/${id}`)).data;
    assert.equal(detail.beneficiary_name, ticket().beneficiaryName);
    assert.equal(detail.bank_account, ticket().bankAccount);
    assert.equal(detail.messages[0].body, "Comentario de prueba");
    await s.db
      .prepare(
        "UPDATE profiles SET full_name='Legacy Name',dossier=? WHERE user_id=?",
      )
      .bind(
        JSON.stringify({
          ...JSON.parse(profile.dossier),
          phone: "+12025550123",
        }),
        u.id,
      )
      .run();
    await s.db
      .prepare(
        "UPDATE tickets SET beneficiary_name='Legacy Recipient',bank_account='12345678' WHERE id=?",
      )
      .bind(id)
      .run();
    await s.db
      .prepare("UPDATE ticket_messages SET body='Legacy comment' WHERE id=?")
      .bind(message.id)
      .run();
    const env = { ...encryptionEnv, DB: s.db };
    assert.equal(await encryptLegacyData(env), 3);
    assert.equal(await encryptLegacyData(env), 0);
    assert.equal((await u.req("/api/me")).data.profile.name, "Legacy Name");
    assert.equal(
      (await u.req(`/api/tickets/${id}`)).data.messages[0].body,
      "Legacy comment",
    );
    assert.equal(
      (await u.req(`/api/tickets/${id}`, { action: "cancelled", version: 0 }))
        .status,
      200,
    );
    assert.equal(await encryptLegacyData(env), 0);
    const erased = await s.db
      .prepare("SELECT beneficiary_name,bank_account FROM tickets WHERE id=?")
      .bind(id)
      .first();
    assert.deepEqual(erased, { beneficiary_name: "", bank_account: "" });
  } finally {
    await s.mf.dispose();
  }
});

test("legacy documents download with sandboxed headers and admin MFA recovery is single-use", async () => {
  const s = await setup();
  try {
    const admin = await s.registered("admin@example.test");
    const user = await s.registered("legacydoc@example.test");
    const enabled = await admin.req("/api/auth/two-factor/enable", {
      password: admin.password,
    });
    assert.equal(enabled.status, 200);
    const secret = decodeBase32(
      new URL(enabled.data.totpURI).searchParams.get("secret"),
    );
    assert.equal(
      (
        await admin.req("/api/auth/two-factor/verify-totp", {
          code: await createOTP(secret).totp(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin.req("/api/admin/unlock", {
          code: enabled.data.backupCodes[0],
          backup: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin.req("/api/admin/unlock", {
          code: enabled.data.backupCodes[0],
          backup: true,
        })
      ).status,
      403,
    );
    const profile = await s.db
      .prepare("SELECT dossier FROM profiles WHERE user_id=?")
      .bind(user.id)
      .first();
    await s.db
      .prepare("UPDATE profiles SET dossier=? WHERE user_id=?")
      .bind(
        JSON.stringify({
          ...JSON.parse(profile.dossier),
          front: "legacy/file",
        }),
        user.id,
      )
      .run();
    await (
      await s.mf.getR2Bucket("DOCUMENTS")
    ).put("legacy/file", "<script>alert(1)</script>", {
      httpMetadata: { contentType: "text/html" },
    });
    const download = await admin.req(`/api/admin/documents/${user.id}/front`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /^attachment/);
    assert.equal(
      download.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.match(download.headers.get("content-security-policy"), /sandbox/);
  } finally {
    await s.mf.dispose();
  }
});
test("delivery uses the frozen ticket calculation and validates currency conversion", () => {
  const t = {
    amount: 5000,
    currency: "NIO",
    estimate: { net: 4400 },
    quote: null,
  };
  assert.equal(deliveryAmount(t, "36.23").received, 159412);
  assert.equal(deliveryAmount({ ...t, currency: "USD" }).received, 4400);
  for (const rate of ["", 0, -1, "abc", "1e2", "36.12345", 1001])
    assert.throws(() => deliveryAmount(t, rate));
  assert.equal(
    deliveryAmount({ ...t, quote: { fee: 600, received: 159412, rate: 36.23 } })
      .received,
    159412,
  );
});
test("new and reviewing tickets accept payment without issuing a quotation", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("directpayment@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(customer.id)
      .run();
    for (const [amount, currency, review] of [
      ["50", "USD", false],
      ["50", "NIO", true],
      ["600", "USD", false],
    ]) {
      const created = await customer.req(
        "/api/tickets",
        ticket({ amount, currency }),
      );
      assert.equal(created.status, 201);
      const p = "/api/admin/tickets/" + created.data.id;
      let version = 0;
      if (review) {
        assert.equal(
          (await admin.req(p, { action: "reviewing", version })).status,
          200,
        );
        version++;
      }
      const initial = (await customer.req("/api/tickets/" + created.data.id))
        .data;
      assert.equal(initial.quote, null);
      assert.equal(
        (
          await admin.req(p + "/processing", {
            action: "start",
            version,
            fee: "0",
            received: "99999",
          })
        ).status,
        200,
      );
      version++;
      const paid = (await customer.req("/api/tickets/" + created.data.id)).data;
      assert.equal(paid.status, "paid");
      assert.equal(paid.quote, null);
      assert.deepEqual(paid.estimate, initial.estimate);
      if (currency === "NIO") {
        assert.equal(
          (await admin.req(p + "/processing", { action: "complete", version }))
            .status,
          400,
        );
        assert.equal(
          (await customer.req("/api/tickets/" + created.data.id)).data.status,
          "paid",
        );
      }
      assert.equal(
        (
          await admin.req(p + "/processing", {
            action: "complete",
            version,
            exchangeRate: "36.23",
            received: 99999,
          })
        ).status,
        200,
      );
      const done = (await customer.req("/api/tickets/" + created.data.id)).data;
      assert.equal(done.status, "delivered");
      assert.equal(done.quote, null);
      assert.equal(done.delivery_amount.netUSD, initial.estimate.net);
      assert.equal(
        done.delivery_amount.received,
        currency === "NIO" ? 159412 : initial.estimate.net,
      );
      assert.equal(done.delivery_amount.currency, currency);
    }
    const cancelled = await customer.req("/api/tickets", ticket());
    assert.equal(
      (
        await customer.req("/api/tickets/" + cancelled.data.id, {
          action: "cancelled",
          version: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin.req(
          "/api/admin/tickets/" + cancelled.data.id + "/processing",
          { action: "start", version: 1 },
        )
      ).status,
      409,
    );
  } finally {
    await s.mf.dispose();
  }
});
test("ticket display distinguishes payment, delivery, expiration and legacy closure", () => {
  const t = { status: "quoted", expires_at: 50 };
  assert.equal(ticketStage(t, 100), "expired");
  assert.equal(ticketStage({ ...t, processing_started_at: 20 }, 100), "paid");
  assert.equal(
    ticketStage(
      { ...t, processing_started_at: 20, processing_completed_at: 30 },
      100,
    ),
    "delivered",
  );
  assert.equal(ticketStage({ ...t, status: "closed" }, 100), "closed");
  assert.equal(
    ticketStage({ ...t, status: "cancelled", processing_started_at: 20 }, 100),
    "cancelled",
  );
});
test("Express purchases require payment then delivery confirmation and finish in customer history", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("expressflow@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(customer.id)
      .run();
    for (const amount of ["50", "500"]) {
      const r = await customer.req(
        "/api/tickets",
        ticket({ amount, currency: "NIO" }),
      );
      assert.equal(r.status, 201);
      const id = r.data.id,
        path = "/api/admin/tickets/" + id;
      assert.equal(
        (await admin.req(path, { action: "reviewing", version: 0 })).status,
        200,
      );
      const quote = {
        fee: "6.00",
        received: ((Number(amount) - 6) * 36.23).toFixed(2),
        rate: "36.23",
        hours: "1",
        validity: "60",
      };
      assert.equal(
        (await admin.req(path, { action: "quote", quote, version: 1 })).status,
        200,
      );
      assert.equal(
        (await admin.req(path, { action: "closed", version: 2 })).status,
        409,
      );
      assert.equal(
        (
          await admin.req(path + "/processing", {
            action: "complete",
            version: 2,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await customer.req(path + "/processing", {
            action: "start",
            version: 2,
          })
        ).status,
        403,
      );
      assert.equal(
        (await admin.req(path + "/processing", { action: "start", version: 2 }))
          .status,
        200,
      );
      const paid = (await customer.req("/api/tickets/" + id)).data;
      assert.equal(paid.status, "paid");
      assert.equal(paid.processing_completed_at, null);
      assert.equal(
        (await admin.req(path, { action: "cancelled", version: 3 })).status,
        409,
      );
      assert.equal(
        (await admin.req(path, { action: "quote", quote, version: 3 })).status,
        409,
      );
      assert.equal(
        (
          await customer.req("/api/tickets/" + id, {
            action: "cancelled",
            version: 3,
          })
        ).status,
        409,
      );
      await s.db
        .prepare("UPDATE tickets SET expires_at=? WHERE id=?")
        .bind(Date.now() - 1000, id)
        .run();
      assert.equal(
        (await customer.req("/api/tickets/" + id)).data.status,
        "paid",
      );
      assert.equal(
        (await customer.req("/api/account/history?status=paid")).data.total,
        1,
      );
      assert.equal(
        (await customer.req("/api/account/history?status=active")).data.total,
        1,
      );
      assert.equal(
        (await customer.req("/api/account/history?status=expired")).data.total,
        0,
      );
      const done = await Promise.all([
        admin.req(path + "/processing", { action: "complete", version: 3 }),
        admin.req(path + "/processing", { action: "complete", version: 3 }),
      ]);
      assert.deepEqual(done.map((r) => r.status).sort(), [200, 409]);
      const delivered = (await customer.req("/api/tickets/" + id)).data;
      assert.equal(delivered.status, "delivered");
      assert.equal(delivered.canMessage, false);
      assert.equal(delivered.bank_account, "");
      assert.equal(delivered.beneficiary_name, "");
      assert.equal(
        delivered.events.filter((e) => e.action === "delivery_confirmed")
          .length,
        1,
      );
      assert.equal((await admin.req(path)).data.status, "delivered");
      assert.equal(
        (
          await s.db
            .prepare("SELECT status FROM tickets WHERE id=?")
            .bind(id)
            .first()
        ).status,
        "closed",
      );
      assert.equal(
        (await customer.req("/api/account/history?status=paid")).data.total,
        0,
      );
    }
    assert.equal(
      (await customer.req("/api/account/history?status=delivered")).data.total,
      2,
    );
    assert.equal(
      (await customer.req("/api/account/history?status=active")).data.total,
      0,
    );
    assert.equal(
      (await customer.req("/api/account/history?status=closed")).data.total,
      0,
    );
  } finally {
    await s.mf.dispose();
  }
});
test("customer password changes require proof and revoke other sessions", async () => {
  const s = await setup();
  try {
    const u = await s.registered("password@example.test");
    const second = s.client();
    assert.equal(
      (
        await second("/api/auth/sign-in/email", {
          email: "password@example.test",
          password: u.password,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await u.req("/api/auth/change-password", {
          currentPassword: "wrong-password",
          newPassword: "replacement-password-12345",
        })
      ).status,
      400,
    );
    const changed = await u.req("/api/auth/change-password", {
      currentPassword: u.password,
      newPassword: "replacement-password-12345",
      revokeOtherSessions: false,
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await u.req("/api/me")).status, 200);
    assert.equal((await second("/api/me")).status, 401);
    const third = s.client();
    assert.equal(
      (
        await third("/api/auth/sign-in/email", {
          email: "password@example.test",
          password: u.password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await third("/api/auth/sign-in/email", {
          email: "password@example.test",
          password: "replacement-password-12345",
        })
      ).status,
      200,
    );
    await u.req("/api/auth/request-password-reset", {
      email: "password@example.test",
      redirectTo: origin + "/",
    });
    for (let n = 0; n < 30 && s.emails.length < 2; n++)
      await new Promise((r) => setTimeout(r, 20));
    const reset = new URL(s.emails.at(-1).text.match(/https:\/\/\S+/)[0]);
    const redirect = await s.client()(reset.pathname + reset.search);
    const token = new URL(redirect.headers.get("location")).searchParams.get(
      "token",
    );
    assert.ok(token);
    assert.equal(
      (
        await s.client()("/api/auth/reset-password", {
          token,
          newPassword: "reset-password-123456789",
        })
      ).status,
      200,
    );
    assert.equal((await u.req("/api/me")).status, 401);
    assert.equal((await third("/api/me")).status, 401);
  } finally {
    await s.mf.dispose();
  }
});

test("history paginates, filters, scopes ownership and hides expired destinations", async () => {
  const s = await setup();
  try {
    const u = await s.registered("history@example.test");
    const other = await s.registered("otherhistory@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(u.id)
      .run();
    const made = await u.req("/api/tickets", ticket());
    assert.equal(made.status, 201);
    const source = await s.db
      .prepare("SELECT * FROM tickets WHERE id=?")
      .bind(made.data.id)
      .first();
    const inserts = [];
    for (let n = 0; n < 24; n++)
      inserts.push(
        s.db
          .prepare(
            "INSERT INTO tickets(id,user_id,request_key,amount,mode,bank,currency,estimate,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            "SE-HISTORY-" + n,
            u.id,
            crypto.randomUUID(),
            source.amount,
            source.mode,
            "",
            source.currency,
            source.estimate,
            n === 0 ? "closed" : "submitted",
            Date.now() - n - 1,
            Date.now(),
            Date.now() - 1000,
          ),
      );
    await s.db.batch(inserts);
    const first = (await u.req("/api/account/history")).data;
    const second = (await u.req("/api/account/history?page=2")).data;
    assert.equal(first.total, 25);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 5);
    assert.equal(
      new Set([...first.items, ...second.items].map((t) => t.id)).size,
      25,
    );
    assert.equal((await other.req("/api/account/history")).data.total, 0);
    assert.equal(
      (await u.req("/api/account/history?status=closed")).data.total,
      1,
    );
    assert.equal(
      (await u.req("/api/account/history?status=active")).data.total,
      1,
    );
    const expired = (await u.req("/api/account/history?status=expired")).data;
    assert.equal(expired.total, 23);
    assert.ok(
      expired.items.every(
        (t) => t.status === "expired" && !t.beneficiary_name && !t.bank_account,
      ),
    );
    assert.equal(
      (await u.req("/api/account/history?q=SE-HISTORY-23")).data.total,
      1,
    );
    assert.equal(
      (await u.req("/api/account/history?status=invalid")).status,
      400,
    );
  } finally {
    await s.mf.dispose();
  }
});

test("account deletion erases related records and legacy files, not other users", async () => {
  const s = await setup();
  try {
    const u = await s.registered("delete@example.test");
    const other = await s.registered("keep@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active',dossier=? WHERE user_id=?")
      .bind(
        JSON.stringify({ front: "legacy/front", back: "legacy/back" }),
        u.id,
      )
      .run();
    const bucket = await s.mf.getR2Bucket("DOCUMENTS");
    await bucket.put("legacy/front", "test front");
    await bucket.put("legacy/back", "test back");
    const created = await u.req("/api/tickets", ticket());
    assert.equal(created.status, 201);
    const tid = created.data.id;
    assert.equal(
      (
        await u.req("/api/tickets/" + tid + "/messages", {
          message: "Comentario de prueba",
        })
      ).status,
      201,
    );
    await s.db
      .prepare(
        "INSERT INTO account_notices(id,user_id,status,reason,created_at) VALUES(?,?,'active','Cuenta aprobada',?)",
      )
      .bind(crypto.randomUUID(), u.id, Date.now())
      .run();
    await s.db
      .prepare(
        "INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        "reset-delete",
        "reset-password:delete",
        u.id,
        Date.now() + 60000,
        Date.now(),
        Date.now(),
      )
      .run();
    assert.equal(
      (
        await u.req("/api/account/delete", {
          password: u.password,
          confirmation: "no",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await u.req("/api/account/delete", {
          password: "wrong-password",
          confirmation: "ELIMINAR",
        })
      ).status,
      403,
    );
    const result = await u.req("/api/account/delete", {
      password: u.password,
      confirmation: "ELIMINAR",
      userId: other.id,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal((await u.req("/api/me")).status, 401);
    assert.equal((await other.req("/api/me")).status, 200);
    for (const [table, column] of [
      ["user", "id"],
      ["session", "userId"],
      ["account", "userId"],
      ["profiles", "user_id"],
      ["registration_consents", "user_id"],
      ["tickets", "user_id"],
      ["account_notices", "user_id"],
      ["ticket_messages", "author_id"],
      ["audit_events", "actor_id"],
    ]) {
      assert.equal(
        (
          await s.db
            .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`)
            .bind(u.id)
            .first()
        ).n,
        0,
        table,
      );
    }
    assert.equal(
      (
        await s.db
          .prepare("SELECT count(*) AS n FROM audit_events WHERE target_id=?")
          .bind(tid)
          .first()
      ).n,
      0,
    );
    assert.equal(
      (
        await s.db
          .prepare("SELECT count(*) AS n FROM notifications WHERE ticket_id=?")
          .bind(tid)
          .first()
      ).n,
      0,
    );
    assert.equal(
      (
        await s.db
          .prepare("SELECT count(*) AS n FROM verification WHERE value=?")
          .bind(u.id)
          .first()
      ).n,
      0,
    );
    for (let n = 0; n < 30 && (await bucket.head("legacy/back")); n++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(await bucket.head("legacy/front"), null);
    assert.equal(await bucket.head("legacy/back"), null);
  } finally {
    await s.mf.dispose();
  }
});

test("deletion blocks live quotes, pending deliveries and admin; bad passwords lock IP", async () => {
  const s = await setup();
  try {
    const u = await s.registered("blockeddelete@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(u.id)
      .run();
    const t = await u.req("/api/tickets", ticket({ amount: "600" }));
    await s.db
      .prepare("UPDATE tickets SET status='quoted' WHERE id=?")
      .bind(t.data.id)
      .run();
    const body = { password: u.password, confirmation: "ELIMINAR" };
    assert.equal((await u.req("/api/account/delete", body)).status, 409);
    await s.db
      .prepare(
        "UPDATE tickets SET expires_at=?,processing_started_at=? WHERE id=?",
      )
      .bind(Date.now() - 1000, Date.now(), t.data.id)
      .run();
    assert.equal((await u.req("/api/account/delete", body)).status, 409);
    assert.equal((await u.req("/api/me")).status, 200);
    const admin = await s.registered("admin@example.test");
    assert.equal(
      (
        await admin.req("/api/account/delete", {
          password: admin.password,
          confirmation: "ELIMINAR",
        })
      ).status,
      403,
    );
    for (let n = 0; n < 3; n++)
      assert.equal(
        (
          await u.req("/api/account/delete", {
            ...body,
            password: "wrong-password",
          })
        ).status,
        403,
      );
    assert.equal((await u.req("/api/account/delete", body)).status, 429);
    await s.db
      .prepare("UPDATE tickets SET processing_completed_at=? WHERE id=?")
      .bind(Date.now(), t.data.id)
      .run();
    const fresh = s.client();
    assert.equal(
      (
        await fresh("/api/auth/sign-in/email", {
          email: "blockeddelete@example.test",
          password: u.password,
        })
      ).status,
      200,
    );
    assert.equal((await fresh("/api/account/delete", body)).status, 200);
  } finally {
    await s.mf.dispose();
  }
});
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
        DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
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
    "0009_ticket_processing.sql",
    "0010_account_deletion.sql",
    "0011_ticket_delivery_amount.sql",
    "0012_security_events.sql",
    "0013_chat_encrypted_length.sql",
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
      fullName: "Cliente de Prueba",
      phone: "+12025550123",
      paypalOwnership: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (
      let n = 0;
      n < 30 &&
      !emails.some(
        (e) =>
          e.to.includes(email) && e.text.includes("/api/auth/verify-email"),
      );
      n++
    )
      await new Promise((r) => setTimeout(r, 20));
    const message = emails.find(
      (e) => e.to.includes(email) && e.text.includes("/api/auth/verify-email"),
    );
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
    fullName: "Cliente de Prueba",
    phone: "+12025550123",
    paypalOwnership: "on",
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
test("registration contact data is validated, private and never auto-approves", async () => {
  const valid = {
    fullName: "  Ana   María López  ",
    phone: "+1 (202) 555-0123",
    paypalOwnership: true,
    legalAccepted: true,
    legalVersion: CertificateModel.version,
  };
  const normalized = CertificateModel.registration(valid, 123);
  assert.equal(normalized.fullName, "Ana María López");
  assert.equal(normalized.phone, "+12025550123");
  assert.equal(normalized.acceptedAt, 123);
  assert.doesNotMatch(CertificateModel.reviewNotice, /Nicaragua|48 horas/);
  assert.match(
    CertificateModel.reviewNotice,
    /2 días hábiles, de lunes a viernes/,
  );
  const invalid = [
    { fullName: "Ana" },
    { fullName: "<script> Test" },
    { fullName: "a".repeat(121) },
    { phone: "2025550123" },
    { phone: "+000123456" },
    { phone: 12025550123 },
    { paypalOwnership: false },
    { paypalOwnership: "false" },
    { paypalEmail: "private@example.test" },
    { legalVersion: "old" },
  ];
  for (const bad of invalid)
    assert.throws(() => CertificateModel.registration({ ...valid, ...bad }));
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    for (const bad of invalid) {
      const r = await s.client()("/api/auth/sign-up/email", {
        ...valid,
        email: "invalid@example.test",
        password: "test-only-password-987654",
        ...bad,
      });
      assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    assert.equal(
      (await s.db.prepare("SELECT COUNT(*) n FROM user").first()).n,
      0,
    );
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("contact@example.test");
    const me = (await customer.req("/api/me")).data;
    assert.equal(me.profile.name, "Cliente de Prueba");
    assert.equal(me.profile.phone, "+12025550123");
    assert.equal(me.profile.paypalOwnership, true);
    assert.equal(me.profile.status, "pending");
    assert.equal((await customer.req("/api/tickets", ticket())).status, 403);
    assert.equal(
      (await customer.req(`/api/admin/users/${customer.id}`)).status,
      403,
    );
    const reviewed = await admin.req(`/api/admin/users/${customer.id}`);
    assert.equal(reviewed.data.full_name, me.profile.name);
    assert.equal(reviewed.data.dossier.phone, me.profile.phone);
    assert.equal(reviewed.data.dossier.paypalOwnership, true);
    assert.equal(reviewed.data.dossier.paypalEmail, undefined);
    assert.ok(reviewed.data.emailVerified);
    assert.ok(!JSON.stringify(s.emails).includes(me.profile.phone));
  } finally {
    await s.mf.dispose();
  }
});

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
  assert.equal(p.fullName, "Cliente de Prueba");
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
  assert.equal(p.phone, "+12025550123");
  assert.equal(p.paypalOwnership, true);
  assert.equal(p.acceptedAt, 123);
  assert.equal(p.status, undefined);
  assert.equal(p.front, undefined);
  for (const key of [
    "version",
    "declaration",
    "terms",
    "privacy",
    "fullName",
    "phone",
    "paypalOwnership",
  ])
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
    // Ciphertext is longer than the plaintext: the largest accepted messages
    // (1000 UTF-16 units, up to 3 bytes each) must fit the column and decrypt
    // to the exact original text.
    const longMessages = ["ñ".repeat(1000), "😀".repeat(500), "€".repeat(1000)];
    for (const text of longMessages) {
      r = await a.req(`/api/tickets/${id}/messages`, { message: text });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.body, text);
    }
    const longConversation = await a.req("/api/tickets/" + id);
    const longBodies = longConversation.data.messages.map(
      (message) => message.body,
    );
    for (const text of longMessages) assert.ok(longBodies.includes(text));
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
      fullName: "Cliente de Prueba",
      phone: "+12025550123",
      paypalOwnership: true,
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
      fullName: "Cliente de Prueba",
      phone: "+12025550123",
      paypalOwnership: true,
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
    assert.match(profile.full_name, /^enc:v1:/);
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
test("six preset amounts use the same validated ticket contract as a custom amount", async () => {
  assert.deepEqual(
    CertificateModel.presetAmounts,
    [50, 100, 200, 300, 400, 500],
  );
  const s = await setup();
  try {
    const customer = await s.registered("presets@example.test");
    assert.equal(
      (await customer.req("/api/tickets", ticket({ amount: "50" }))).status,
      403,
    );
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(customer.id)
      .run();
    assert.equal(
      (
        await customer.req(
          "/api/tickets",
          ticket({ amount: "50", beneficiaryName: "", bankAccount: "" }),
        )
      ).status,
      400,
    );
    for (const amount of [...CertificateModel.presetAmounts, 164]) {
      const created = await customer.req(
        "/api/tickets",
        ticket({ amount: String(amount) }),
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const detail = await customer.req("/api/tickets/" + created.data.id);
      assert.equal(detail.data.amount, amount * 100);
      assert.equal(detail.data.estimate.amount, amount * 100);
      assert.ok(detail.data.estimate.net < detail.data.amount);
      assert.equal(detail.data.bank_account, ticket().bankAccount);
      assert.equal(
        detail.data.terms_version,
        CertificateModel.ticketConditionsVersion,
      );
      assert.equal(detail.data.expires_at - detail.data.created_at, 86400000);
    }
  } finally {
    await s.mf.dispose();
  }
});
test("ticket expiry distinguishes USD 500 from international and skips weekends", () => {
  const friday = Date.parse("2026-09-25T23:30:00-06:00");
  assert.equal(ticketExpiry(50000, friday), friday + 86400000);
  assert.equal(
    ticketExpiry(50001, friday),
    Date.parse("2026-10-05T23:30:00-06:00"),
  );
  const saturday = Date.parse("2026-09-26T10:00:00-06:00");
  assert.equal(
    ticketExpiry(60000, saturday),
    Date.parse("2026-10-05T10:00:00-06:00"),
  );
});

test("international business-day counter skips weekends and respects local dates", () => {
  const friday = Date.parse("2026-09-25T23:30:00-06:00");
  assert.equal(
    new Date(addBusinessDays(friday, 2)).toISOString(),
    "2026-09-30T05:30:00.000Z",
  );
  assert.equal(
    new Date(addBusinessDays(friday, 6)).toISOString(),
    "2026-10-06T05:30:00.000Z",
  );
  assert.equal(
    new Date(
      addBusinessDays(Date.parse("2026-12-31T10:00:00-06:00"), 2),
    ).toISOString(),
    "2027-01-04T16:00:00.000Z",
  );
  assert.equal(processingWindow({ amount: 50000 }), null);
  assert.equal(processingWindow({ amount: 50001 }).status, "pending");
  const t = { amount: 60000, processing_started_at: friday };
  assert.equal(processingWindow(t, friday + 86400000).elapsed, 0);
  assert.equal(
    processingWindow(t, addBusinessDays(friday, 2)).status,
    "window",
  );
  assert.equal(
    processingWindow(t, addBusinessDays(friday, 6)).status,
    "overdue",
  );
  const done = processingWindow(
    { ...t, processing_completed_at: addBusinessDays(friday, 3) },
    addBusinessDays(friday, 9),
  );
  assert.equal(done.status, "completed");
  assert.equal(done.elapsed, 3);
});

test("WhatsApp summary links to authenticated ticket without destination data", () => {
  const t = {
    id: "SE-ABC123",
    amount: 60000,
    estimate: { net: 54000 },
    bank_account: "000987654321",
    beneficiary_name: "Beneficiario de Prueba",
    bank: "LAFISE",
    messages: [{ body: "private" }],
  };
  const text = ticketShareText(t, origin);
  assert.match(text, /USD 600\.00/);
  assert.match(text, /USD 540\.00/);
  assert.match(text, /2 a 6 días hábiles/);
  assert.match(text, /\?ticket=SE-ABC123/);
  for (const secret of [t.bank_account, t.beneficiary_name, t.bank, "private"])
    assert.ok(!text.includes(secret));
  assert.ok(
    !ticketShareText({ ...t, amount: 50000 }, origin).includes("2 a 6"),
  );
});

test("legacy international tickets keep their accepted retention when payment is confirmed", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("legacy-retention@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(customer.id)
      .run();
    const created = await customer.req(
      "/api/tickets",
      ticket({ amount: "600" }),
    );
    assert.equal(created.status, 201);
    const id = created.data.id;
    const oldExpiry = Date.now() + 86400000;
    await s.db
      .prepare("UPDATE tickets SET terms_version=?,expires_at=? WHERE id=?")
      .bind("ticket-condiciones-2026-09-27-v3", oldExpiry, id)
      .run();
    assert.equal(
      (
        await admin.req(`/api/admin/tickets/${id}/processing`, {
          action: "start",
          version: 0,
        })
      ).status,
      200,
    );
    const detail = (await customer.req(`/api/tickets/${id}`)).data;
    assert.equal(detail.expires_at, oldExpiry);
    assert.equal(detail.status, "paid");
    assert.equal(detail.terms_version, "ticket-condiciones-2026-09-27-v3");
  } finally {
    await s.mf.dispose();
  }
});

test("only admin can start paid international tracking; expiry erases destination but retains tracking", async () => {
  const s = await setup(true, { ADMIN_REQUIRE_MFA: "false" });
  try {
    const admin = await s.registered("admin@example.test");
    const customer = await s.registered("tracking@example.test");
    const stranger = await s.registered("stranger@example.test");
    await s.db
      .prepare("UPDATE profiles SET status='active' WHERE user_id=?")
      .bind(customer.id)
      .run();
    const created = await customer.req(
      "/api/tickets",
      ticket({ amount: "600" }),
    );
    assert.equal(created.status, 201);
    const id = created.data.id;
    const path = `/api/admin/tickets/${id}`;
    const action = path + "/processing";
    const initial = (await customer.req(`/api/tickets/${id}`)).data;
    assert.equal(initial.expires_at, addBusinessDays(initial.created_at, 6));
    // A still-open international ticket retains destination and chat after 24h.
    await s.db
      .prepare("UPDATE tickets SET created_at=?,expires_at=? WHERE id=?")
      .bind(Date.now() - 2 * 86400000, Date.now() + 86400000, id)
      .run();
    const afterDayOne = (await customer.req(`/api/tickets/${id}`)).data;
    assert.equal(afterDayOne.bank_account, ticket().bankAccount);
    assert.equal(afterDayOne.canMessage, true);
    assert.equal(
      (
        await customer.req(`/api/tickets/${id}/messages`, {
          message: "Consulta de seguimiento",
        })
      ).status,
      201,
    );
    assert.equal(
      (await s.client()(action, { action: "start", version: 0 })).status,
      401,
    );
    assert.equal(
      (await customer.req(action, { action: "start", version: 0 })).status,
      403,
    );
    assert.equal(
      (await admin.req(action, { action: "start", version: 99 })).status,
      409,
    );
    assert.equal(
      (await admin.req(path, { action: "reviewing", version: 0 })).status,
      200,
    );
    assert.equal(
      (
        await admin.req(path, {
          action: "quote",
          version: 1,
          quote: {
            received: "540",
            fee: "60",
            rate: 1,
            hours: 144,
            validity: 60,
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await admin.req(action, { action: "complete", version: 2 })).status,
      409,
    );
    assert.equal(
      (await admin.req(action, { action: "start", version: 1 })).status,
      409,
    );
    const confirmations = await Promise.all([
      admin.req(action, { action: "start", version: 2 }),
      admin.req(action, { action: "start", version: 2 }),
    ]);
    assert.deepEqual(confirmations.map((r) => r.status).sort(), [200, 409]);
    const started = (await customer.req(`/api/tickets/${id}`)).data;
    assert.equal(started.status, "paid");
    assert.ok(started.processing_started_at > 0);
    assert.deepEqual(started.quote.businessDays, { min: 2, max: 6 });
    assert.equal(started.quote.hours, undefined);
    assert.equal(started.processing_completed_at, null);
    assert.equal(
      started.expires_at,
      addBusinessDays(started.processing_started_at, 6),
    );
    assert.equal(started.bank_account, ticket().bankAccount);
    assert.equal(started.canMessage, true);
    assert.equal(
      started.events.filter((e) => e.action === "payment_confirmed").length,
      1,
    );
    assert.equal(
      (await admin.req(action, { action: "start", version: 3 })).status,
      409,
    );
    assert.equal((await stranger.req(`/api/tickets/${id}`)).status, 404);
    await s.db
      .prepare("UPDATE tickets SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, id)
      .run();
    const expired = (await customer.req(`/api/tickets/${id}`)).data;
    assert.equal(expired.status, "paid");
    assert.equal(expired.bank_account, "");
    assert.equal(expired.beneficiary_name, "");
    assert.equal(expired.canMessage, false);
    assert.deepEqual(expired.messages, []);
    assert.equal(expired.processing_started_at, started.processing_started_at);
    assert.equal(
      (await admin.req(action, { action: "complete", version: 3 })).status,
      200,
    );
    assert.equal(
      (await admin.req(action, { action: "complete", version: 4 })).status,
      409,
    );
    assert.ok(
      (await customer.req(`/api/tickets/${id}`)).data.processing_completed_at,
    );
    assert.equal(
      (await customer.req(`/api/tickets/${id}`)).data.status,
      "delivered",
    );
    const unstarted = await customer.req(
      "/api/tickets",
      ticket({ amount: "501" }),
    );
    await s.db
      .prepare("UPDATE tickets SET status='quoted',expires_at=? WHERE id=?")
      .bind(Date.now() - 1, unstarted.data.id)
      .run();
    assert.equal(
      (
        await admin.req(`/api/admin/tickets/${unstarted.data.id}/processing`, {
          action: "start",
          version: 0,
        })
      ).status,
      409,
    );
    const express = await customer.req(
      "/api/tickets",
      ticket({ amount: "500" }),
    );
    assert.equal(
      (
        await admin.req(`/api/admin/tickets/${express.data.id}/processing`, {
          action: "start",
          version: 0,
        })
      ).status,
      200,
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
