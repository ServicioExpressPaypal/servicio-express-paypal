import { createAuth, sendMail, sendMailContent } from "./auth";
import { accountDecisionMail, passwordChangedMail } from "./email-templates";
import { setupEnabled, inviteAdmin, completeAdminSetup } from "./admin-setup";
import "../../../calculator-core.js";
import "../../../_pilot/tickets/domain.js";
import "../../../_pilot/tickets/accounts.js";
import CertificateModel from "../public/certificate.js";
import {
  ipKey,
  reserveAttempt,
  releaseSuccessfulLogin,
  verifyBot,
  ProtectionError,
  reserveAccountAttempt,
  releaseAccountAttempt,
} from "./protection";
import {
  encryptField,
  decryptField,
  profileFields,
  ticketFields,
  encryptLegacyData,
} from "./encryption";
import {
  securityEvent,
  securityMaintenance,
  instrumentDatabase,
} from "./security-events";
import { purgeExpiredTicketData } from "./retention";
import { advanceQueue, queueInfo, settleQueue } from "./queue";
import { eraseAccount, purgeDeletedDocuments } from "./customer-account";
import {
  ticketStage,
  deliveryAmount,
  ticketExpiry,
} from "../public/processing.js";

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
  beneficiary_name: string;
  bank: string;
  bank_account: string;
  currency: string;
  terms_version: string;
  terms_accepted_at: number;
  estimate: string;
  status: string;
  quote: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
  processing_started_at: number | null;
  processing_completed_at: number | null;
  delivery_amount: string | null;
};
type TicketMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: "customer" | "admin";
  body: string;
  created_at: number;
};
type TicketNotification = {
  ticket_id: string;
  amount: number;
  mode: string;
  estimate: string;
  expires_at: number;
  whatsapp_delivered: number;
  whatsapp_attempts: number;
};
const finalTicketStatuses = new Set(["closed", "cancelled"]);
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
  "/change-password",
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
  const consent = await env.DB.prepare(
    "SELECT version,accepted_at FROM registration_consents WHERE user_id=?",
  )
    .bind(id)
    .first<{ version: string; accepted_at: number }>();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles(user_id,status,dossier,updated_at) VALUES(?,?,?,?)",
  )
    .bind(
      id,
      consent ? "pending" : "incomplete",
      consent
        ? JSON.stringify({
            kind: "minimal-account",
            version: consent.version,
            acceptedAt: consent.accepted_at,
          })
        : null,
      Date.now(),
    )
    .run();
  const row = (await env.DB.prepare("SELECT * FROM profiles WHERE user_id=?")
    .bind(id)
    .first<Profile>())!;
  return {
    ...row,
    ...(await profileFields(env, row.user_id, row.full_name, row.dossier)),
  };
}
const EXPRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPRESS_DAILY_LIMIT_CENTS = 50000;
function ticketRoom(env: Env, ticketId: string) {
  return env.TICKET_ROOM.get(env.TICKET_ROOM.idFromName(ticketId));
}
function broadcastTicket(env: Env, ticketId: string, event: unknown) {
  return ticketRoom(env, ticketId)
    .fetch("https://room/broadcast", {
      method: "POST",
      body: JSON.stringify(event),
    })
    .catch(() => undefined);
}
async function ticketChanged(env: Env, ticketId: string) {
  const result = await advanceQueue(env);
  await settleQueue(env, result, { force: true, extraIds: [ticketId] });
}
function isTicketExpired(t: Ticket, now = Date.now()) {
  return t.expires_at <= now;
}
async function publicTicket(
  env: Env,
  t: Ticket,
  now = Date.now(),
  includeBankAccount = false,
) {
  const expired = isTicketExpired(t, now);
  const erased =
    expired || finalTicketStatuses.has(t.status) || !!t.processing_completed_at;
  const { bank_account, ...safeTicket } = t;
  return {
    ...safeTicket,
    beneficiary_name: erased
      ? ""
      : await decryptField(
          env,
          t.beneficiary_name,
          `ticket:${t.id}:beneficiary`,
        ),
    bank: erased ? "" : t.bank,
    destinationErased: erased,
    ...(includeBankAccount
      ? {
          bank_account: erased
            ? ""
            : await decryptField(env, bank_account, `ticket:${t.id}:account`),
        }
      : {}),
    status: ticketStage(t, now),
    expired,
    canMessage: !erased,
    estimate: JSON.parse(t.estimate),
    quote: t.quote ? JSON.parse(t.quote) : null,
    delivery_amount: t.delivery_amount ? JSON.parse(t.delivery_amount) : null,
  };
}
function messageBody(value: unknown) {
  if (typeof value !== "string") return fail(400, "Escribe un mensaje.");
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > 1000)
    fail(400, "El mensaje debe contener entre 1 y 1,000 caracteres.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    fail(400, "El mensaje contiene caracteres no admitidos.");
  return text;
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
function ticketMoney(cents: number) {
  return `USD ${(cents / 100).toFixed(2)}`;
}
async function notifyWhatsApp(env: Env, ticketId: string) {
  if (env.WHATSAPP_PROVIDER !== "meta") return;
  const notice = await env.DB.prepare(
    "SELECT n.ticket_id,n.whatsapp_delivered,n.whatsapp_attempts,t.amount,t.mode,t.estimate,t.expires_at FROM notifications n JOIN tickets t ON t.id=n.ticket_id WHERE n.ticket_id=? AND n.whatsapp_delivered=0 AND n.whatsapp_attempts<5",
  )
    .bind(ticketId)
    .first<TicketNotification>();
  if (!notice) return;
  try {
    if (
      !env.WHATSAPP_ACCESS_TOKEN ||
      !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || "") ||
      !/^\d+$/.test(env.WHATSAPP_ADMIN_NUMBER || "") ||
      !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION || "") ||
      !env.WHATSAPP_TEMPLATE_NAME
    )
      throw new Error("Configuración de WhatsApp incompleta.");
    const estimate = JSON.parse(notice.estimate) as { net: number };
    const response = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: env.WHATSAPP_ADMIN_NUMBER,
          type: "template",
          template: {
            name: env.WHATSAPP_TEMPLATE_NAME,
            language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "es" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: notice.ticket_id },
                  { type: "text", text: ticketMoney(notice.amount) },
                  { type: "text", text: ticketMoney(estimate.net) },
                  {
                    type: "text",
                    text:
                      notice.mode === "express"
                        ? "Certificado en efectivo"
                        : "Método internacional",
                  },
                  {
                    type: "text",
                    text: new Date(notice.expires_at).toLocaleString("es-NI", {
                      timeZone: "America/Managua",
                    }),
                  },
                  { type: "text", text: env.APP_URL },
                ],
              },
            ],
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(`WhatsApp respondió con estado ${response.status}.`);
    const result = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    await env.DB.prepare(
      "UPDATE notifications SET whatsapp_delivered=1,whatsapp_message_id=? WHERE ticket_id=?",
    )
      .bind(result.messages?.[0]?.id || null, ticketId)
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE notifications SET whatsapp_attempts=whatsapp_attempts+1,whatsapp_next_attempt_at=? WHERE ticket_id=?",
    )
      .bind(Date.now() + 15 * 60000, ticketId)
      .run();
    console.error(
      JSON.stringify({ event: "ticket_whatsapp_failed", ticketId }),
    );
  }
}
async function notifyAccountDecision(env: Env, noticeId: string) {
  if (env.EMAIL_PROVIDER === "disabled") return;
  const notice = await env.DB.prepare(
    "SELECT n.status,n.reason,u.email FROM account_notices n JOIN user u ON u.id=n.user_id WHERE n.id=? AND n.delivered=0",
  )
    .bind(noticeId)
    .first<{ status: string; reason: string; email: string }>();
  if (!notice) return;
  try {
    await sendMailContent(
      env,
      notice.email,
      accountDecisionMail(notice.status, notice.reason, env.APP_URL),
    );
    await env.DB.prepare("UPDATE account_notices SET delivered=1 WHERE id=?")
      .bind(noticeId)
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE account_notices SET attempts=attempts+1,next_attempt_at=? WHERE id=?",
    )
      .bind(Date.now() + 3600000, noticeId)
      .run();
    console.error(JSON.stringify({ event: "account_notice_failed", noticeId }));
  }
}
async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  security: { actor?: string },
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  const canonical = new URL(env.APP_URL);
  if (canonical.protocol === "https:" && url.protocol !== "https:") {
    url.protocol = "https:";
    url.host = canonical.host;
    return Response.redirect(url.toString(), 308);
  }
  if (!["GET", "HEAD", "POST"].includes(request.method))
    fail(405, "Método no permitido.");
  if (env.MAINTENANCE_MODE === "true") {
    if (request.method !== "GET" && request.method !== "HEAD")
      fail(503, "El sitio está en preparación.");
    if (path.startsWith("/api/")) fail(503, "El sitio está en preparación.");
    const maintenanceUrl = new URL("/index.html", request.url);
    return env.ASSETS.fetch(
      new Request(maintenanceUrl, {
        method: request.method,
        headers: request.headers,
      }),
    );
  }
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== env.APP_URL
  )
    fail(403, "Origen no permitido.");
  if (path.startsWith("/api/") && env.API_LIMITER) {
    const limited = await env.API_LIMITER.limit({
      key: request.headers.get("cf-connecting-ip") || "unknown",
    });
    if (!limited.success)
      throw new ProtectionError(
        429,
        "Demasiadas solicitudes. Espera un minuto.",
        60,
      );
  }
  if (path === "/api/health") {
    return json({ ok: true });
  }
  if (path === "/api/config")
    return json({
      registrationOpen:
        env.REGISTRATION_OPEN === "true" && env.EMAIL_PROVIDER !== "disabled",
      kycOpen: env.KYC_OPEN === "true",
      whatsappEnabled: env.WHATSAPP_PROVIDER === "meta",
      turnstileSiteKey:
        env.TURNSTILE_ENABLED === "true" ? env.TURNSTILE_SITE_KEY : null,
    });
  if (!path.startsWith("/api/")) {
    if (request.method !== "GET" && request.method !== "HEAD")
      fail(405, "Método no permitido.");
    if (path === "/" || path === "/index.html") {
      const appUrl = new URL("/app-shell.html", request.url);
      return env.ASSETS.fetch(
        new Request(appUrl, {
          method: request.method,
          headers: request.headers,
        }),
      );
    }
    return env.ASSETS.fetch(request);
  }
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
    const resetCallback =
      request.method === "GET" &&
      /^\/reset-password\/[A-Za-z0-9_-]{10,200}$/.test(endpoint);
    if (!authPaths.has(endpoint) && !resetCallback) fail(404, "No disponible.");
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
    if (request.method !== "POST") return auth.handler(request);
    const data = await payload(request);
    const actions: Record<string, string> = {
      "/sign-up/email": "signup",
      "/sign-in/email": "login",
      "/request-password-reset": "recover",
      "/send-verification-email": "resend",
      "/change-password": "password",
    };
    const action = actions[endpoint];
    let key: string | undefined;
    let reservation: { count: number; expires_at: number } | undefined;
    let accountReservation: Awaited<ReturnType<typeof reserveAccountAttempt>>;
    if (action) {
      key = await ipKey(request, env);
      reservation = await reserveAttempt(env, key, action === "signup");
      await verifyBot(request, env, data.turnstileToken, action);
      delete data.turnstileToken;
      if (["login", "recover", "resend"].includes(action)) {
        try {
          accountReservation = await reserveAccountAttempt(
            env,
            data.email,
            action,
          );
        } catch (error) {
          ctx.waitUntil(
            securityEvent(env, "account_locked", String(data.email || "")),
          );
          throw error;
        }
      }
    }
    if (endpoint === "/sign-up/email") {
      try {
        // Auth stores a generic display name; reviewed contact data lives in profiles.
        const { name: _name, ...registration } = data;
        const checked = CertificateModel.registration(registration);
        data.fullName = checked.fullName;
        data.phone = checked.phone;
      } catch (error) {
        fail(400, (error as Error).message);
      }
      data.name = "Cliente";
      delete data.image;
    }
    if (endpoint === "/change-password") data.revokeOtherSessions = true;
    const passwordOwner =
      endpoint === "/change-password"
        ? await auth.api.getSession({ headers: request.headers })
        : null;
    const response = await auth.handler(
      new Request(request, { body: JSON.stringify(data) }),
    );
    if (
      ["/sign-in/email", "/change-password"].includes(endpoint) &&
      response.ok &&
      key &&
      reservation
    )
      await releaseSuccessfulLogin(env, key, reservation.count);
    if (endpoint === "/sign-in/email" && response.ok && accountReservation)
      await releaseAccountAttempt(env, accountReservation);
    if (endpoint === "/sign-in/email" && !response.ok)
      ctx.waitUntil(
        securityEvent(env, "auth_failed", String(data.email || "")),
      );
    if (endpoint === "/change-password" && response.ok && passwordOwner) {
      ctx.waitUntil(
        sendMailContent(
          env,
          passwordOwner.user.email,
          passwordChangedMail(),
        ).catch(() =>
          console.error(JSON.stringify({ event: "security_mail_failed" })),
        ),
      );
      ctx.waitUntil(
        securityEvent(env, "password_changed", passwordOwner.user.id),
      );
    }
    return response;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.emailVerified)
    fail(401, "Inicia sesión con tu correo verificado.");
  const user = session!.user,
    sid = session!.session.id;
  security.actor = user.id;
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
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
      },
      consent: await env.DB.prepare(
        "SELECT version,accepted_at FROM registration_consents WHERE user_id=?",
      )
        .bind(user.id)
        .first(),
      admin,
      adminReady,
      twoFactorEnabled: !!user.twoFactorEnabled,
      profile: {
        status: profile.status,
        name: profile.full_name,
        phone: profile.dossier ? JSON.parse(profile.dossier).phone : undefined,
        reason: profile.reason,
        bank: profile.dossier ? JSON.parse(profile.dossier).bank : undefined,
        currency: profile.dossier
          ? JSON.parse(profile.dossier).currency
          : undefined,
      },
    });
  if (request.method === "POST") await rate(env, `user:${user.id}`, 30, 60);
  if (path === "/api/account/delete" && request.method === "POST") {
    if (admin)
      fail(
        403,
        "La cuenta de administrador no se elimina desde el portal de clientes.",
      );
    const data = await payload(request);
    if (data.confirmation !== "ELIMINAR")
      fail(400, "Escribe ELIMINAR para confirmar.");
    if (
      typeof data.password !== "string" ||
      !data.password ||
      data.password.length > 128
    )
      fail(400, "Escribe tu contraseña actual.");
    const key = await ipKey(request, env);
    const reservation = await reserveAttempt(env, key);
    await verifyBot(request, env, data.turnstileToken, "delete");
    try {
      await auth.api.verifyPassword({
        headers: request.headers,
        body: { password: data.password },
      });
    } catch {
      fail(
        403,
        "Contraseña incorrecta o sesión vencida. Vuelve a iniciar sesión si el problema continúa.",
      );
    }
    await releaseSuccessfulLogin(env, key, reservation.count);
    const erased = await eraseAccount(env, user.id, user.email);
    if (!erased)
      fail(
        409,
        "Hay una cotización vigente o una entrega pendiente. Contacta al administrador para resolverla antes de eliminar tu cuenta.",
      );
    ctx.waitUntil(purgeDeletedDocuments(env));
    return json({ ok: true });
  }
  if (path === "/api/account/history" && request.method === "GET") {
    await purgeExpiredTicketData(env);
    const url = new URL(request.url);
    const page = Math.max(
      1,
      Math.min(
        100000,
        Number.parseInt(url.searchParams.get("page") || "1", 10) || 1,
      ),
    );
    const query = (url.searchParams.get("q") || "").slice(0, 80).trim();
    const filter = url.searchParams.get("status") || "all";
    const now = Date.now();
    const predicates: Record<string, string> = {
      all: "1=1",
      active:
        "(status NOT IN ('closed','cancelled') AND expires_at>? AND processing_completed_at IS NULL) OR (processing_started_at IS NOT NULL AND processing_completed_at IS NULL AND status!='cancelled')",
      expired:
        "expires_at<=? AND status NOT IN ('closed','cancelled') AND processing_started_at IS NULL AND processing_completed_at IS NULL",
      closed:
        "status='closed' AND processing_started_at IS NULL AND processing_completed_at IS NULL",
      paid: "processing_started_at IS NOT NULL AND processing_completed_at IS NULL AND status!='cancelled'",
      delivered: "processing_completed_at IS NOT NULL AND status!='cancelled'",
      cancelled: "status='cancelled'",
    };
    if (!Object.hasOwn(predicates, filter)) fail(400, "Filtro inválido.");
    const where = `user_id=? AND instr(lower(id),lower(?))>0 AND (${predicates[filter]})`;
    const args: (string | number)[] = [user.id, query];
    if (filter === "active" || filter === "expired") args.push(now);
    const count = await env.DB.prepare(
      `SELECT count(*) AS total FROM tickets WHERE ${where}`,
    )
      .bind(...args)
      .first<{ total: number }>();
    const rows = await env.DB.prepare(
      `SELECT * FROM tickets WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?`,
    )
      .bind(...args, (page - 1) * 20)
      .all<Ticket>();
    return json({
      items: await Promise.all(
        rows.results.map((ticket) => publicTicket(env, ticket)),
      ),
      total: count!.total,
      page,
      pageSize: 20,
    });
  }
  if (path === "/api/admin/unlock" && request.method === "POST") {
    if (!admin || !user.twoFactorEnabled)
      fail(403, "Configura el doble factor primero.");
    await rate(env, `admin-unlock:${user.id}`, 5, 300);
    const body = await payload(request);
    if (
      typeof body.code !== "string" ||
      (body.backup
        ? !/^[A-Za-z0-9-]{8,32}$/.test(body.code)
        : !/^\d{6}$/.test(body.code))
    )
      fail(400, "Escribe un código válido.");
    try {
      if (body.backup === true) {
        await auth.api.verifyBackupCode({
          headers: request.headers,
          body: { code: body.code, trustDevice: false },
        });
      } else {
        await auth.api.verifyTOTP({
          headers: request.headers,
          body: { code: body.code, trustDevice: false },
        });
      }
    } catch {
      ctx.waitUntil(securityEvent(env, "admin_unlock_failed", user.id));
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
      fail(
        503,
        "La recepción de datos para revisión todavía no está habilitada.",
      );
    if (!["incomplete", "correction"].includes(profile.status))
      fail(409, "El expediente ya fue enviado.");
    await rate(env, `kyc:${user.id}`, 3, 3600);
    const data = await payload(request);
    if (["front", "back", "source", "detail"].some((key) => key in data))
      fail(
        400,
        "Este formulario no admite fotografías ni documentos adicionales.",
      );
    let p;
    try {
      p = CertificateModel.validate(data);
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    // Keep references to any legacy documents; changing this form is not a deletion request.
    const old = profile.dossier ? JSON.parse(profile.dossier) : {};
    const { fullName, ...reviewData } = p;
    const dossier = JSON.stringify({
      ...reviewData,
      ...(old.front ? { front: old.front } : {}),
      ...(old.back ? { back: old.back } : {}),
    });
    const secured = await profileFields(env, user.id, fullName, dossier, true);
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
      ).bind(
        secured.full_name,
        secured.dossier,
        Date.now(),
        user.id,
        profile.version,
      ),
    ]);
    if (!result[1].results.length)
      fail(409, "El expediente cambió. Recarga e intenta de nuevo.");
    return json({ ok: true });
  }
  if (path === "/api/tickets" && request.method === "GET") {
    await purgeExpiredTicketData(env);
    const rows = await env.DB.prepare(
      "SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100",
    )
      .bind(user.id)
      .all<Ticket>();
    return json(
      await Promise.all(
        rows.results.map((ticket) => publicTicket(env, ticket)),
      ),
    );
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
    if (existing) return json(await publicTicket(env, existing));
    await rate(env, `tickets:${user.id}`, 10, 3600);
    let estimate;
    try {
      const amount = TicketModel.cents(body.amount);
      const mode = SaldoCalculator.modeForAmount(amount);
      estimate = SaldoCalculator.estimate(amount, mode);
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    let destination;
    try {
      destination = CertificateModel.validateTicket(body);
    } catch (e) {
      return fail(400, (e as Error).message);
    }
    const id = `SE-${crypto.randomUUID().toUpperCase()}`,
      now = Date.now(),
      expiresAt = ticketExpiry(estimate.amount, now);
    if (estimate.mode === "express") {
      const open = await env.DB.prepare(
        "SELECT 1 AS found FROM tickets WHERE user_id=? AND mode='express' AND status NOT IN ('closed','cancelled') AND expires_at>? AND processing_completed_at IS NULL LIMIT 1",
      )
        .bind(user.id, now)
        .first();
      if (open)
        fail(
          409,
          "Ya tienes un ticket Express en proceso. Podrás crear otro cuando se complete o venza.",
        );
      const recent = await env.DB.prepare(
        "SELECT amount,created_at FROM tickets WHERE user_id=? AND mode='express' AND status!='cancelled' AND created_at>? ORDER BY created_at",
      )
        .bind(user.id, now - EXPRESS_WINDOW_MS)
        .all<{ amount: number; created_at: number }>();
      let total = recent.results.reduce((sum, r) => sum + r.amount, 0);
      if (total + estimate.amount > EXPRESS_DAILY_LIMIT_CENTS) {
        let availableAt = now + EXPRESS_WINDOW_MS;
        for (const r of recent.results) {
          total -= r.amount;
          if (total + estimate.amount <= EXPRESS_DAILY_LIMIT_CENTS) {
            availableAt = r.created_at + EXPRESS_WINDOW_MS;
            break;
          }
        }
        fail(
          409,
          `Alcanzaste el límite Express de USD 500 por 24 horas. Podrás crear otro ticket Express a partir del ${new Date(availableAt).toLocaleString("es", { timeZone: "America/Managua", dateStyle: "medium", timeStyle: "short" })}.`,
        );
      }
    }
    // Settle due rotations first so the new ticket joins the back of the line.
    await advanceQueue(env, now, { restartAlone: true });
    const secured = await ticketFields(
      env,
      {
        id,
        beneficiary_name: destination.beneficiaryName,
        bank_account: destination.bankAccount,
      },
      true,
    );
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO tickets(id,user_id,request_key,amount,mode,beneficiary_name,bank,bank_account,currency,terms_version,terms_accepted_at,estimate,created_at,updated_at,expires_at,queue_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND status='active' AND version=?)",
        ).bind(
          id,
          user.id,
          body.requestKey,
          estimate.amount,
          estimate.mode,
          secured.beneficiary_name,
          destination.bank,
          secured.bank_account,
          destination.currency,
          destination.termsVersion,
          destination.termsAcceptedAt,
          JSON.stringify(estimate),
          now,
          now,
          expiresAt,
          now,
          user.id,
          profile.version,
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
      if (replay) return json(await publicTicket(env, replay));
      throw e;
    }
    ctx.waitUntil(notify(env, id));
    ctx.waitUntil(notifyWhatsApp(env, id));
    ctx.waitUntil(ticketChanged(env, id));
    return json({ id }, 201);
  }
  if (path === "/api/admin/users" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT p.user_id,p.full_name,p.status,p.reason,p.version,u.email FROM profiles p JOIN user u ON u.id=p.user_id ORDER BY p.updated_at DESC LIMIT 100",
    ).all();
    return json(
      await Promise.all(
        rows.results.map(async (row) => ({
          ...row,
          full_name: await decryptField(
            env,
            String(row.full_name),
            `profile:${row.user_id}:name`,
          ),
        })),
      ),
    );
  }
  const dossierMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (dossierMatch) {
    const target = await env.DB.prepare(
      "SELECT p.*,u.email,u.emailVerified FROM profiles p JOIN user u ON u.id=p.user_id WHERE p.user_id=?",
    )
      .bind(dossierMatch[1])
      .first<Profile & { email: string }>();
    if (!target) fail(404, "Usuario no encontrado.");
    if (request.method === "GET") {
      await audit(env, user.id, target!.user_id, "dossier_viewed").run();
      const decrypted = await profileFields(
        env,
        target!.user_id,
        target!.full_name,
        target!.dossier,
      );
      const dossier = decrypted.dossier ? JSON.parse(decrypted.dossier) : null;
      if (dossier) {
        dossier.hasDocuments = !!(dossier.front || dossier.back);
        delete dossier.front;
        delete dossier.back;
      }
      const notices = await env.DB.prepare(
        "SELECT status,reason,delivered,created_at FROM account_notices WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
        .bind(target!.user_id)
        .all();
      return json({
        ...target,
        full_name: decrypted.full_name,
        dossier,
        notices: notices.results,
      });
    }
    const body = await payload(request);
    const owner = await env.DB.prepare(
      "SELECT emailVerified FROM user WHERE id=?",
    )
      .bind(target!.user_id)
      .first<{ emailVerified: number }>();
    const account = {
      status: target!.status,
      verifiedAt: owner?.emailVerified ? 1 : null,
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
    const now = Date.now(),
      noticeId = crypto.randomUUID();
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
        now,
        target!.user_id,
        body.version,
      ),
      env.DB.prepare(
        "INSERT INTO account_notices(id,user_id,status,reason,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND version=?) RETURNING id",
      ).bind(
        noticeId,
        target!.user_id,
        account.status,
        account.reason,
        now,
        target!.user_id,
        body.version + 1,
      ),
    ]);
    if (!result[1].results.length)
      fail(409, "El expediente cambió. Recarga antes de decidir.");
    ctx.waitUntil(notifyAccountDecision(env, noticeId));
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
    const key = JSON.parse(p!.dossier)[documentMatch[2]];
    if (typeof key !== "string") fail(404, "Documento no encontrado.");
    const object = await env.DOCUMENTS.get(key);
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
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="documento"',
        "content-security-policy":
          "sandbox; default-src 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (path === "/api/admin/tickets" && request.method === "GET") {
    await purgeExpiredTicketData(env);
    const rows = await env.DB.prepare(
      "SELECT t.*,p.full_name,u.email FROM tickets t JOIN profiles p ON p.user_id=t.user_id JOIN user u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 100",
    ).all<Ticket>();
    return json(
      await Promise.all(
        rows.results.map(async (ticket) => ({
          ...(await publicTicket(env, ticket)),
          full_name: await decryptField(
            env,
            String((ticket as Ticket & { full_name: string }).full_name),
            `profile:${ticket.user_id}:name`,
          ),
        })),
      ),
    );
  }
  const liveMatch = path.match(
    /^\/api\/(admin\/)?tickets\/(SE-[A-F0-9-]+)\/live$/,
  );
  if (liveMatch) {
    if (request.method !== "GET") fail(405, "Método no permitido.");
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      fail(426, "Se requiere una conexión WebSocket.");
    if (request.headers.get("origin") !== env.APP_URL)
      fail(403, "Origen no permitido.");
    const target = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
      .bind(liveMatch[2])
      .first<Ticket>();
    if (!target || (!liveMatch[1] && target.user_id !== user.id))
      fail(404, "Solicitud no encontrada.");
    if (isTicketExpired(target!) || finalTicketStatuses.has(target!.status))
      fail(409, "La conversación de este ticket ya está cerrada.");
    return ticketRoom(env, target!.id).fetch("https://room/connect", {
      headers: { upgrade: "websocket" },
    });
  }
  const messageMatch = path.match(
    /^\/api\/(admin\/)?tickets\/(SE-[A-F0-9-]+)\/messages$/,
  );
  if (messageMatch) {
    if (request.method !== "POST") fail(405, "Método no permitido.");
    const target = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
      .bind(messageMatch[2])
      .first<Ticket>();
    if (!target || (!messageMatch[1] && target.user_id !== user.id))
      fail(404, "Solicitud no encontrada.");
    if (isTicketExpired(target!) || finalTicketStatuses.has(target!.status))
      fail(409, "La conversación de este ticket ya está cerrada.");
    await rate(env, `messages:${user.id}:${target!.id}`, 30, 3600);
    const body = await payload(request),
      message = messageBody(body.message),
      id = crypto.randomUUID(),
      now = Date.now(),
      role = messageMatch[1] ? "admin" : "customer";
    const securedMessage = await encryptField(env, message, `message:${id}`);
    const result = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO ticket_messages(id,ticket_id,author_id,author_role,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tickets WHERE id=? AND expires_at>? AND status NOT IN ('closed','cancelled')) RETURNING id",
      ).bind(
        id,
        target!.id,
        user.id,
        role,
        securedMessage,
        now,
        target!.id,
        now,
      ),
      env.DB.prepare(
        "UPDATE tickets SET updated_at=? WHERE id=? AND expires_at>? AND status NOT IN ('closed','cancelled')",
      ).bind(now, target!.id, now),
      env.DB.prepare(
        "INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ticket_messages WHERE id=?)",
      ).bind(
        crypto.randomUUID(),
        user.id,
        target!.id,
        "message_sent",
        role,
        now,
        id,
      ),
    ]);
    if (!result[0].results.length)
      fail(409, "La conversación de este ticket ya está cerrada.");
    const sent = { id, author_role: role, body: message, created_at: now };
    ctx.waitUntil(
      broadcastTicket(env, target!.id, { type: "message", message: sent }),
    );
    return json(sent, 201);
  }
  const processingMatch = path.match(
    /^\/api\/admin\/tickets\/(SE-[A-F0-9-]+)\/processing$/,
  );
  if (processingMatch && request.method === "POST") {
    const body = await payload(request);
    const target = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
      .bind(processingMatch[1])
      .first<Ticket>();
    if (!target) fail(404, "Solicitud no encontrada.");
    if (body.version !== target!.version)
      fail(409, "La solicitud cambió. Recarga antes de continuar.");
    const now = Date.now();
    const starting = body.action === "start";
    if (starting) {
      if (
        !["submitted", "reviewing", "quoted"].includes(target!.status) ||
        isTicketExpired(target!, now) ||
        target!.processing_started_at ||
        target!.processing_completed_at
      )
        fail(
          409,
          "Solo puedes confirmar el pago de un ticket vigente, no cancelado y sin confirmación previa.",
        );
    } else if (body.action === "complete") {
      if (
        !target!.processing_started_at ||
        target!.processing_completed_at ||
        target!.status === "cancelled"
      )
        fail(409, "El seguimiento no está pendiente de entrega.");
    } else fail(400, "Acción no permitida.");
    const column = starting
      ? "processing_started_at"
      : "processing_completed_at";
    // Only extend retention for tickets that accepted the new conditions.
    const expiresAt =
      starting &&
      target!.amount > 50000 &&
      CertificateModel.hasExtendedInternationalValidity(target!.terms_version)
        ? ticketExpiry(target!.amount, now)
        : target!.expires_at;
    let delivery = target!.delivery_amount;
    if (!starting) {
      try {
        delivery = JSON.stringify(
          deliveryAmount(
            {
              ...target!,
              estimate: JSON.parse(target!.estimate),
              quote: target!.quote ? JSON.parse(target!.quote) : null,
            },
            body.exchangeRate,
          ),
        );
      } catch (error) {
        fail(400, (error as Error).message);
      }
    }
    const result = await env.DB.batch([
      env.DB.prepare(
        `UPDATE tickets SET ${column}=?,delivery_amount=?,expires_at=?,${starting ? "" : "status='closed',"}version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id`,
      ).bind(now, delivery, expiresAt, now, target!.id, body.version),
      env.DB.prepare(
        "INSERT INTO audit_events(id,actor_id,target_id,action,detail,created_at) SELECT ?,?,?,?,'',? WHERE changes()=1",
      ).bind(
        crypto.randomUUID(),
        user.id,
        target!.id,
        starting ? "payment_confirmed" : "delivery_confirmed",
        now,
      ),
    ]);
    if (!result[0].results.length)
      fail(409, "La solicitud cambió. Recarga antes de continuar.");
    await purgeExpiredTicketData(env);
    ctx.waitUntil(ticketChanged(env, target!.id));
    return json({ ok: true });
  }
  const ticketMatch = path.match(/^\/api\/(admin\/)?tickets\/(SE-[A-F0-9-]+)$/);
  if (ticketMatch) {
    await purgeExpiredTicketData(env);
    const target = await env.DB.prepare("SELECT * FROM tickets WHERE id=?")
      .bind(ticketMatch[2])
      .first<Ticket>();
    if (!target || (!ticketMatch[1] && target.user_id !== user.id))
      fail(404, "Solicitud no encontrada.");
    if (request.method === "GET") {
      const [events, messages, notification] = await Promise.all([
        env.DB.prepare(
          "SELECT action,detail,created_at FROM audit_events WHERE target_id=? AND action!='message_sent' ORDER BY created_at",
        )
          .bind(target!.id)
          .all(),
        env.DB.prepare(
          "SELECT id,author_role,body,created_at FROM ticket_messages WHERE ticket_id=? ORDER BY created_at,id LIMIT 200",
        )
          .bind(target!.id)
          .all<TicketMessage>(),
        ticketMatch[1]
          ? env.DB.prepare(
              "SELECT delivered AS email_delivered,whatsapp_delivered,whatsapp_attempts FROM notifications WHERE ticket_id=?",
            )
              .bind(target!.id)
              .first()
          : Promise.resolve(null),
      ]);
      const turns = await advanceQueue(env);
      ctx.waitUntil(settleQueue(env, turns));
      return json({
        ...(await publicTicket(env, target!, Date.now(), true)),
        queue: queueInfo(env, turns.queue, target!.id),
        events: events.results,
        messages:
          isTicketExpired(target!) ||
          finalTicketStatuses.has(target!.status) ||
          !!target!.processing_completed_at
            ? []
            : await Promise.all(
                messages.results.map(async (message) => ({
                  ...message,
                  body: await decryptField(
                    env,
                    message.body,
                    `message:${message.id}`,
                  ),
                })),
              ),
        ...(ticketMatch[1] ? { notification } : {}),
      });
    }
    if (isTicketExpired(target!))
      fail(409, "Este ticket venció. Crea uno nuevo para continuar.");
    const body = await payload(request);
    if (target!.processing_started_at || target!.processing_completed_at)
      fail(
        409,
        "El pago ya fue confirmado. Completa el envío desde la acción de entrega; no puedes cancelar ni cambiar la cotización.",
      );
    if (body.action === "closed")
      fail(
        409,
        "Para finalizar, confirma primero el pago y después el envío al beneficiario.",
      );
    const ticket = {
      ...target!,
      expiresAt: target!.expires_at,
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
      } else if (body.action === "quote") {
        TicketModel.quote(
          ticket,
          ticket.amount > 50000 ? { ...body.quote, hours: 144 } : body.quote,
        );
        if (ticket.amount > 50000) {
          delete ticket.quote.hours;
          ticket.quote.businessDays = { min: 2, max: 6 };
        }
      } else {
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
    const now = Date.now();
    const result = await env.DB.batch([
      env.DB.prepare(
        "UPDATE tickets SET status=?,quote=?,version=version+1,updated_at=? WHERE id=? AND version=? AND expires_at>? RETURNING id",
      ).bind(
        ticket.status,
        ticket.quote ? JSON.stringify(ticket.quote) : null,
        now,
        target!.id,
        body.version,
        now,
      ),
      guardedAudit(
        env,
        "tickets",
        user.id,
        target!.id,
        body.version + 1,
        ticket.status,
      ),
    ]);
    if (!result[0].results.length)
      fail(409, "La solicitud cambió. Recarga antes de continuar.");
    if (finalTicketStatuses.has(ticket.status))
      await purgeExpiredTicketData(env);
    ctx.waitUntil(ticketChanged(env, target!.id));
    return json({ ok: true });
  }
  return fail(404, "No encontrado.");
}
export { TicketRoom } from "./ticket-room";
export default {
  async fetch(request, env, ctx) {
    let response: Response;
    const metrics = { queries: 0, durationMs: 0, failures: 0 };
    const securedEnv = { ...env, DB: instrumentDatabase(env.DB, metrics) };
    const security: { actor?: string } = {};
    const start = performance.now();
    try {
      response = await handle(request, securedEnv, ctx, security);
    } catch (e) {
      if (!(e instanceof HttpError) && !(e instanceof ProtectionError))
        console.error(
          JSON.stringify({ event: "request_failed", id: crypto.randomUUID() }),
        );
      response = json(
        {
          error:
            e instanceof HttpError || e instanceof ProtectionError
              ? e.message
              : "No se pudo completar la solicitud.",
        },
        e instanceof HttpError || e instanceof ProtectionError ? e.status : 500,
      );
      if (e instanceof ProtectionError && e.retryAfter)
        response.headers.set("retry-after", String(e.retryAfter));
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    const path = new URL(request.url).pathname;
    const route = path.startsWith("/api/auth/")
      ? "auth"
      : path.startsWith("/api/admin/")
        ? "admin"
        : path.startsWith("/api/")
          ? "api"
          : "assets";
    if (route !== "assets")
      console.log(
        JSON.stringify({
          event: "request_metrics",
          route,
          status: response.status,
          durationMs: Math.round(performance.now() - start),
          dbQueries: metrics.queries,
          dbMs: Math.round(metrics.durationMs),
          dbFailures: metrics.failures,
        }),
      );
    const event =
      response.status >= 500 && response.status !== 503
        ? "server_error"
        : response.status === 429
          ? "request_blocked"
          : response.ok && route === "admin"
            ? request.method === "POST"
              ? "admin_write"
              : "admin_read"
            : null;
    if (event)
      ctx.waitUntil(
        securityEvent(env, event, security.actor).catch(() =>
          console.error(JSON.stringify({ event: "security_log_failed" })),
        ),
      );
    headers.set("cache-control", "no-store");
    if (new URL(request.url).protocol === "https:")
      headers.set("strict-transport-security", "max-age=15552000");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-frame-options", "DENY");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (!headers.has("content-security-policy"))
      headers.set(
        "content-security-policy",
        `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' wss://${new URL(env.APP_URL).host} https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env, ctx) {
    await purgeDeletedDocuments(env);
    await purgeExpiredTicketData(env);
    await encryptLegacyData(env);
    ctx.waitUntil(securityMaintenance(env));
    ctx.waitUntil(advanceQueue(env).then((result) => settleQueue(env, result)));
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
    if (env.WHATSAPP_PROVIDER === "meta") {
      const whatsappJobs = await env.DB.prepare(
        "SELECT ticket_id FROM notifications WHERE whatsapp_delivered=0 AND whatsapp_attempts<5 AND whatsapp_next_attempt_at<=? LIMIT 20",
      )
        .bind(Date.now())
        .all<{ ticket_id: string }>();
      for (const job of whatsappJobs.results)
        ctx.waitUntil(notifyWhatsApp(env, job.ticket_id));
    }
    const accountJobs = await env.DB.prepare(
      "SELECT id FROM account_notices WHERE delivered=0 AND attempts<5 AND next_attempt_at<=? LIMIT 20",
    )
      .bind(Date.now())
      .all<{ id: string }>();
    for (const job of accountJobs.results)
      ctx.waitUntil(notifyAccountDecision(env, job.id));
  },
} satisfies ExportedHandler<Env>;
