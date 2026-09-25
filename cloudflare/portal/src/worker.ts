import { createAuth, sendMail } from "./auth";
import { setupEnabled, inviteAdmin, completeAdminSetup } from "./admin-setup";
import "../../../calculator-core.js";
import "../../../_pilot/tickets/domain.js";
import "../../../_pilot/tickets/accounts.js";

// The same tested calculator and state machines power the demo and the API.
declare const SaldoCalculator: typeof import("../../../calculator-core.js");
declare const TicketModel: typeof import("../../../_pilot/tickets/domain.js");
declare const AccountModel: typeof import("../../../_pilot/tickets/accounts.js");
type Profile = {
  user_id: string;
  status: string;
  full_name: string;
  dossier: string | null;
  reason: string;
  version: number;
  updated_at: number;
};
type Ticket = {
  id: string;
  user_id: string;
  amount: number;
  mode: string;
  bank: string;
  currency: string;
  estimate: string;
  status: string;
  quote: string | null;
  version: number;
  created_at: number;
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const json = (data: unknown, status = 200) => Response.json(data, { status });
const uuid = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
const authPaths = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/reset-password",
  "/two-factor/enable",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    fail(413, "Archivo o solicitud demasiado grande.");
  const reader = request.body?.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        fail(413, "Archivo o solicitud demasiado grande.");
      }
      chunks.push(new Uint8Array(value).buffer);
    }
  return new Blob(chunks).arrayBuffer();
}
async function payload(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "Formato no admitido.");
  try {
    const data = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 16384)),
    );
    if (!data || typeof data !== "object" || Array.isArray(data))
      fail(400, "Solicitud inválida.");
    return data;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, "Solicitud inválida.");
  }
}
async function rate(env: Env, key: string, max: number, seconds: number) {
  const now = Date.now(),
    expires = now + seconds * 1000;
  const row = await env.DB.prepare(
    `INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at <= ? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at <= ? THEN ? ELSE expires_at END RETURNING count`,
  )
    .bind(key, expires, now, now, expires)
    .first<{ count: number }>();
  if (!row || row.count > max)
    fail(429, "Demasiados intentos. Espera unos minutos.");
}
function audit(
  env: Env,
  actor: string,
  target: string,
  action: string,
  detail = "",
) {
  return env.DB.prepare("INSERT INTO audit_events VALUES(?,?,?,?,?,?)").bind(
    crypto.randomUUID(),
    actor,
    target,
    action,
    detail,
    Date.now(),
  );
}
function guardedAudit(
  env: Env,
  table: "profiles" | "tickets",
  actor: string,
  target: string,
  version: number,
  action: string,
  detail = "",
) {
  const idColumn = table === "profiles" ? "user_id" : "id";
  return env.DB.prepare(
    `INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE ${idColumn}=? AND version=?)`,
  ).bind(
    crypto.randomUUID(),
    actor,
    target,
    action,
    detail,
    Date.now(),
    target,
    version,
  );
}
async function profileFor(env: Env, id: string) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles(user_id,updated_at) VALUES(?,?)",
  )
    .bind(id, Date.now())
    .run();
  return (await env.DB.prepare("SELECT * FROM profiles WHERE user_id=?")
    .bind(id)
    .first<Profile>())!;
}
function publicTicket(t: Ticket) {
  return {
    ...t,
    estimate: JSON.parse(t.estimate),
    quote: t.quote ? JSON.parse(t.quote) : null,
  };
}
async function notify(env: Env, ticketId: string) {
  if (env.EMAIL_PROVIDER === "disabled" || !env.ADMIN_EMAIL) return;
  try {
    await sendMail(
      env,
      env.ADMIN_EMAIL,
      `Nueva solicitud ${ticketId}`,
      `Solicitud ${ticketId} pendiente de revisión. Abre ${env.APP_URL} para revisarla.`,
    );
    await env.DB.prepare(
      "UPDATE notifications SET delivered=1 WHERE ticket_id=?",
    )
      .bind(ticketId)
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE notifications SET attempts=attempts+1,next_attempt_at=? WHERE ticket_id=?",
    )
      .bind(Date.now() + 3600000, ticketId)
      .run();
    console.error(
      JSON.stringify({ event: "ticket_notification_failed", ticketId }),
    );
  }
}
async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (!["GET", "HEAD", "POST"].includes(request.method))
    fail(405, "Método no permitido.");
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== env.APP_URL
  )
    fail(403, "Origen no permitido.");
  if (path === "/api/health") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true });
  }
  if (path === "/api/config")
    return json({
      registrationOpen:
        env.REGISTRATION_OPEN === "true" && env.EMAIL_PROVIDER !== "disabled",
      kycOpen: env.KYC_OPEN === "true",
    });
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (path === "/api/setup/request" || path === "/api/setup/complete") {
    if (request.method !== "POST") fail(405, "Método no permitido.");
    if (!setupEnabled(env))
      fail(503, "La configuración privada no está disponible.");
    await rate(
      env,
      `setup:${path}:${request.headers.get("cf-connecting-ip") || "unknown"}`,
      5,
      300,
    );
    const body = await payload(request);
    if (path === "/api/setup/request") {
      await inviteAdmin(env, ctx);
      return json({ ok: true });
    }
    return completeAdminSetup(request, env, ctx, body);
  }
  const auth = createAuth(env, ctx);
  if (path.startsWith("/api/auth/")) {
    const endpoint = path.slice("/api/auth".length);
    if (!authPaths.has(endpoint)) fail(404, "No disponible.");
    if (
      endpoint === "/sign-up/email" &&
      (env.REGISTRATION_OPEN !== "true" || env.EMAIL_PROVIDER === "disabled")
    )
      fail(503, "El registro aún no está habilitado.");
    if (
      ["/send-verification-email", "/request-password-reset"].includes(
        endpoint,
      ) &&
      env.EMAIL_PROVIDER === "disabled"
    )
      fail(503, "El envío de correo aún no está habilitado.");
    const bounded =
      request.method === "POST"
        ? new Request(request, { body: await limitedBody(request, 16384) })
        : request;
    return auth.handler(bounded);
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.emailVerified)
    fail(401, "Inicia sesión con tu correo verificado.");
  const user = session!.user,
    sid = session!.session.id;
  const admin =
    !!env.ADMIN_EMAIL &&
    user.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
  const profile = await profileFor(env, user.id);
  const requireMfa = env.ADMIN_REQUIRE_MFA !== "false";
  const grant =
    admin && requireMfa && user.twoFactorEnabled
      ? await env.DB.prepare(
          "SELECT expires_at FROM admin_grants WHERE session_id=? AND expires_at>?",
        )
          .bind(sid, Date.now())
          .first()
      : null;
  const adminReady = admin && (!requireMfa || !!grant);
  if (path === "/api/me")
    return json({
      user: { id: user.id, email: user.email },
      admin,
      adminReady,
      twoFactorEnabled: !!user.twoFactorEnabled,
      profile: {
        status: profile.status,
        name: profile.full_name,
        reason: profile.reason,
      },
    });
  if (request.method === "POST") await rate(env, `user:${user.id}`, 30, 60);
  if (path === "/api/admin/unlock" && request.method === "POST") {
    if (!admin || !user.twoFactorEnabled)
      fail(403, "Configura el doble factor primero.");
    await rate(env, `admin-unlock:${user.id}`, 5, 300);
    const body = await payload(request);
    try {
      await auth.api.verifyTOTP({
        headers: request.headers,
        body: { code: String(body.code || ""), trustDevice: false },
      });
    } catch {
      fail(403, "Código incorrecto o vencido.");
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO admin_grants VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at",
      ).bind(sid, Date.now() + 15 * 60000),
      audit(env, user.id, user.id, "admin_unlocked"),
    ]);
    return json({ ok: true });
  }
  if (path.startsWith("/api/admin/") && !adminReady)
    fail(
      403,
      admin
        ? "Confirma tu doble factor para administrar."
        : "Acceso reservado al administrador.",
    );

  if (path === "/api/profile" && request.method === "POST") {
    if (env.KYC_OPEN !== "true")
      fail(503, "La recepción de documentos todavía no está habilitada.");
    if (!["incomplete", "correction"].includes(profile.status))
      fail(409, "El expediente ya fue enviado.");
    await rate(env, `kyc:${user.id}`, 3, 3600);
    const bounded = new Request(request, {
      body: await limitedBody(request, 11 * 1024 * 1024),
    });
    let form: FormData;
    try {
      form = await bounded.formData();
    } catch {
      return fail(400, "Formulario inválido.");
    }
    const data = Object.fromEntries(form);
    const account = {
      status: "incomplete",
      verifiedAt: Date.now(),
      events: [],
      profile: null,
    };
    try {
      AccountModel.submit(account, data);
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    const keys: string[] = [];
    const saved: Record<string, string> = {};
    let committed = false;
    try {
      for (const side of ["front", "back"]) {
        const file = data[side] as File;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const valid =
          file.type === "image/png"
            ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!valid) fail(400, "Usa imágenes JPG o PNG válidas.");
        const key = `${user.id}/${crypto.randomUUID()}/${side}`;
        await env.DOCUMENTS.put(key, bytes, {
          httpMetadata: { contentType: file.type },
        });
        keys.push(key);
        saved[side] = key;
      }
      const p = account.profile as Record<string, unknown> | null;
      if (!p) throw new Error("Profile validation did not produce a dossier");
      const dossier = JSON.stringify({ ...p, ...saved });
      const result = await env.DB.batch([
        guardedAudit(
          env,
          "profiles",
          user.id,
          user.id,
          profile.version,
          "profile_submitted",
        ),
        env.DB.prepare(
          "UPDATE profiles SET full_name=?,dossier=?,status='pending',reason='',version=version+1,updated_at=? WHERE user_id=? AND version=? RETURNING user_id",
        ).bind(p.name, dossier, Date.now(), user.id, profile.version),
      ]);
      if (!result[1].results.length)
        fail(409, "El expediente cambió. Recarga e intenta de nuevo.");
      committed = true;
    } catch (e) {
      if (!committed) for (const key of keys) await env.DOCUMENTS.delete(key);
      throw e;
    }
    // Only the current dossier is retained after a correction.
    if (profile.dossier) {
      const old = JSON.parse(profile.dossier);
      ctx.waitUntil(env.DOCUMENTS.delete([old.front, old.back]));
    }
    return json({ ok: true });
  }
  if (path === "/api/tickets" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT * FROM tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(user.id)
      .all<Ticket>();
    return json(rows.results.map(publicTicket));
  }
  if (path === "/api/tickets" && request.method === "POST") {
    if (profile.status !== "active")
      fail(403, "Tu cuenta debe estar activada para crear solicitudes.");
    const body = await payload(request);
    if (!uuid(body.requestKey)) fail(400, "Referencia de envío inválida.");
    const existing = await env.DB.prepare(
      "SELECT * FROM tickets WHERE user_id=? AND request_key=?",
    )
      .bind(user.id, body.requestKey)
      .first<Ticket>();
    if (existing) return json(publicTicket(existing));
    await rate(env, `tickets:${user.id}`, 10, 3600);
    let estimate;
    try {
      estimate = SaldoCalculator.estimate(
        TicketModel.cents(body.amount),
        body.mode,
      );
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    if (
      !["BAC", "LAFISE", "Banpro", "BDF", "Ficohsa", "Otro"].includes(
        body.bank,
      ) ||
      !["USD", "NIO"].includes(body.currency) ||
      body.consent !== true
    )
      fail(400, "Revisa el banco, la moneda y el consentimiento.");
    const id = `SE-${crypto.randomUUID().toUpperCase()}`,
      now = Date.now();
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO tickets(id,user_id,request_key,amount,mode,bank,currency,estimate,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND status='active')",
        ).bind(
          id,
          user.id,
          body.requestKey,
          estimate.amount,
          body.mode,
          body.bank,
          body.currency,
          JSON.stringify(estimate),
          now,
          now,
          user.id,
        ),
        env.DB.prepare(
          "INSERT INTO notifications(id,ticket_id) VALUES(?,?)",
        ).bind(crypto.randomUUID(), id),
        audit(env, user.id, id, "submitted"),
      ]);
    } catch (e) {
      const replay = await env.DB.prepare(
        "SELECT * FROM tickets WHERE user_id=? AND request_key=?",
      )
        .bind(user.id, body.requestKey)
        .first<Ticket>();
      if (replay) return json(publicTicket(replay));
      throw e;
    }
    ctx.waitUntil(notify(env, id));
    return json({ id }, 201);
  }
  if (path === "/api/admin/users" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT p.user_id,p.full_name,p.status,p.reason,p.version,u.email FROM profiles p JOIN user u ON u.id=p.user_id ORDER BY p.updated_at DESC LIMIT 100",
    ).all();
    return json(rows.results);
  }
  const dossierMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (dossierMatch) {
    const target = await env.DB.prepare(
      "SELECT * FROM profiles WHERE user_id=?",
    )
      .bind(dossierMatch[1])
      .first<Profile>();
    if (!target) fail(404, "Usuario no encontrado.");
    if (request.method === "GET") {
      await audit(env, user.id, target!.user_id, "dossier_viewed").run();
      const dossier = target!.dossier ? JSON.parse(target!.dossier) : null;
      if (dossier) {
        delete dossier.front;
        delete dossier.back;
      }
      return json({ ...target, dossier });
    }
    const body = await payload(request);
    const account = {
      status: target!.status,
      verifiedAt: 1,
      profile: target!.dossier,
      events: [],
      reason: "",
    };
    if (!target!.dossier) fail(409, "El usuario no ha enviado el expediente.");
    try {
      AccountModel.review(account, body.action, body.reason);
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    if (body.version !== target!.version)
      fail(409, "El expediente cambió. Recarga antes de decidir.");
    const result = await env.DB.batch([
      guardedAudit(
        env,
        "profiles",
        user.id,
        target!.user_id,
        body.version,
        `profile_${account.status}`,
        account.reason,
      ),
      env.DB.prepare(
        "UPDATE profiles SET status=?,reason=?,version=version+1,updated_at=? WHERE user_id=? AND version=? RETURNING user_id",
      ).bind(
        account.status,
        account.reason,
        Date.now(),
        target!.user_id,
        body.version,
      ),
    ]);
    if (!result[1].results.length)
      fail(409, "El expediente cambió. Recarga antes de decidir.");
    return json({ ok: true });
  }
  const documentMatch = path.match(
    /^\/api\/admin\/documents\/([^/]+)\/(front|back)$/,
  );
  if (documentMatch && request.method === "GET") {
    const p = await env.DB.prepare(
      "SELECT dossier FROM profiles WHERE user_id=?",
    )
      .bind(documentMatch[1])
      .first<{ dossier: string }>();
    if (!p?.dossier) fail(404, "Documento no encontrado.");
    const object = await env.DOCUMENTS.get(
      JSON.parse(p!.dossier)[documentMatch[2]],
    );
    if (!object) fail(404, "Documento no encontrado.");
    await audit(
      env,
      user.id,
      documentMatch[1],
      "document_viewed",
      documentMatch[2],
    ).run();
    return new Response(object!.body, {
      headers: {
        "content-type":
          object!.httpMetadata?.contentType || "application/octet-stream",
        "content-disposition": "inline",
      },
    });
  }
  if (path === "/api/admin/tickets" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT t.*,p.full_name,u.email FROM tickets t JOIN profiles p ON p.user_id=t.user_id JOIN user u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 100",
    ).all<Ticket>();
    return json(rows.results.map(publicTicket));
  }
  const ticketMatch = path.match(/^\/api\/(admin\/)?tickets\/(SE-[A-F0-9-]+)$/);
  if (ticketMatch) {
    const target = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
      .bind(ticketMatch[2])
      .first<Ticket>();
    if (!target || (!ticketMatch[1] && target.user_id !== user.id))
      fail(404, "Solicitud no encontrada.");
    if (request.method === "GET") {
      const events = await env.DB.prepare(
        "SELECT action,detail,created_at FROM audit_events WHERE target_id=? ORDER BY created_at",
      )
        .bind(target!.id)
        .all();
      return json({ ...publicTicket(target!), events: events.results });
    }
    const body = await payload(request);
    const ticket = {
      ...target!,
      quote: target!.quote ? JSON.parse(target!.quote) : null,
      events: [],
    };
    try {
      if (!ticketMatch[1]) {
        if (
          body.action !== "cancelled" ||
          !["submitted", "reviewing"].includes(ticket.status)
        )
          fail(409, "No puedes cancelar esta solicitud.");
        TicketModel.transition(ticket, "cancelled");
      } else if (body.action === "quote") TicketModel.quote(ticket, body.quote);
      else {
        if (!["reviewing", "closed", "cancelled"].includes(body.action))
          fail(400, "Acción no permitida.");
        TicketModel.transition(ticket, body.action);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return fail(400, (e as Error).message);
    }
    if (body.version !== target!.version)
      fail(409, "La solicitud cambió. Recarga antes de continuar.");
    const result = await env.DB.batch([
      guardedAudit(
        env,
        "tickets",
        user.id,
        target!.id,
        body.version,
        ticket.status,
      ),
      env.DB.prepare(
        "UPDATE tickets SET status=?,quote=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id",
      ).bind(
        ticket.status,
        ticket.quote ? JSON.stringify(ticket.quote) : null,
        Date.now(),
        target!.id,
        body.version,
      ),
    ]);
    if (!result[1].results.length)
      fail(409, "La solicitud cambió. Recarga antes de continuar.");
    return json({ ok: true });
  }
  return fail(404, "No encontrado.");
}
export default {
  async fetch(request, env, ctx) {
    let response: Response;
    try {
      response = await handle(request, env, ctx);
    } catch (e) {
      if (!(e instanceof HttpError))
        console.error(
          JSON.stringify({ event: "request_failed", id: crypto.randomUUID() }),
        );
      response = json(
        {
          error:
            e instanceof HttpError
              ? e.message
              : "No se pudo completar la solicitud.",
        },
        e instanceof HttpError ? e.status : 500,
      );
    }
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-frame-options", "DENY");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env, ctx) {
    await env.DB.prepare("DELETE FROM request_limits WHERE expires_at<?")
      .bind(Date.now())
      .run();
    await env.DB.prepare("DELETE FROM admin_grants WHERE expires_at<?")
      .bind(Date.now())
      .run();
    const jobs = await env.DB.prepare(
      "SELECT ticket_id FROM notifications WHERE delivered=0 AND attempts<5 AND next_attempt_at<=? LIMIT 20",
    )
      .bind(Date.now())
      .all<{ ticket_id: string }>();
    for (const job of jobs.results) ctx.waitUntil(notify(env, job.ticket_id));
  },
} satisfies ExportedHandler<Env>;
