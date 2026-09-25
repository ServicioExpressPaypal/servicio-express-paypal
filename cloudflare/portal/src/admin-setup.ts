import { createAuth, sendMail } from "./auth";

const digest = async (token: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export function setupEnabled(env: Env) {
  return (
    env.ADMIN_SETUP_OPEN === "true" &&
    !!env.ADMIN_EMAIL &&
    env.EMAIL_PROVIDER === "resend" &&
    !!env.RESEND_API_KEY
  );
}

export async function adminExists(env: Env) {
  return !!(await env.DB.prepare(
    "SELECT id FROM user WHERE lower(email)=lower(?)",
  )
    .bind(env.ADMIN_EMAIL)
    .first());
}

export async function inviteAdmin(env: Env, ctx: ExecutionContext) {
  if (await adminExists(env)) return;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const hash = await digest(token),
    now = Date.now();
  const inserted = await env.DB.prepare(
    `INSERT INTO admin_setup(id,email,token_hash,expires_at) VALUES(1,?,?,?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,
       expires_at=excluded.expires_at,claimed_at=NULL
     WHERE admin_setup.expires_at<=? RETURNING id`,
  )
    .bind(env.ADMIN_EMAIL.toLowerCase(), hash, now + 3600000, now)
    .first();
  if (!inserted) return;
  // Only the configured owner receives the token. Neither responses nor logs include it.
  ctx.waitUntil(
    sendMail(
      env,
      env.ADMIN_EMAIL,
      "Configura tu acceso de administrador | Saldo Express",
      `Crea tu cuenta de administrador de Saldo Express con este enlace de un solo uso (vence en 1 hora): ${env.APP_URL}/?setup=1#invite=${token}\n\nTu contrasena y los codigos del autenticador son privados. No los compartas por correo ni por chat.`,
    ).catch(async () => {
      await env.DB.prepare(
        "DELETE FROM admin_setup WHERE token_hash=? AND claimed_at IS NULL",
      )
        .bind(hash)
        .run();
      console.error(JSON.stringify({ event: "admin_invitation_failed" }));
    }),
  );
}

export async function completeAdminSetup(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  body: Record<string, unknown>,
) {
  if (
    typeof body.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.token) ||
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.length > 120 ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    return Response.json(
      { error: "Revisa tu nombre, contrasena e invitacion." },
      { status: 400 },
    );
  const hash = await digest(body.token),
    now = Date.now();
  // Claim atomically before hashing a password so simultaneous uses cannot both create accounts.
  const claimed = await env.DB.prepare(
    `UPDATE admin_setup SET claimed_at=? WHERE id=1 AND token_hash=? AND email=?
     AND claimed_at IS NULL AND expires_at>?
     AND NOT EXISTS(SELECT 1 FROM user WHERE lower(email)=?) RETURNING id`,
  )
    .bind(
      now,
      hash,
      env.ADMIN_EMAIL.toLowerCase(),
      now,
      env.ADMIN_EMAIL.toLowerCase(),
    )
    .first();
  if (!claimed)
    return Response.json(
      { error: "La invitacion vencio o ya fue utilizada." },
      { status: 410 },
    );
  try {
    const response = await createAuth(env, ctx).handler(
      new Request(`${env.APP_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: env.APP_URL,
          "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "",
        },
        body: JSON.stringify({
          name: body.name.trim(),
          password: body.password,
          email: env.ADMIN_EMAIL.toLowerCase(),
          callbackURL: `${env.APP_URL}/`,
        }),
      }),
    );
    if (response.ok) return Response.json({ ok: true });
    return response;
  } finally {
    if (!(await adminExists(env)))
      await env.DB.prepare(
        "UPDATE admin_setup SET claimed_at=NULL WHERE token_hash=? AND claimed_at=?",
      )
        .bind(hash, now)
        .run();
  }
}
