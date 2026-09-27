const WINDOW = 15 * 60 * 1000;
export class ProtectionError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export async function ipKey(request: Request, env: Env) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) throw new ProtectionError(403, "No se pudo verificar la conexión.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function reserveAttempt(env: Env, key: string, signup = false) {
  const now = Date.now();
  const other = await env.DB.prepare(
    "SELECT expires_at FROM request_limits WHERE key=? AND count>=3 AND expires_at>?",
  )
    .bind((signup ? "auth-ip:" : "signup-ip:") + key, now)
    .first<{ expires_at: number }>();
  if (other)
    throw new ProtectionError(
      429,
      "Se alcanzaron 3 intentos. Esta IP está bloqueada temporalmente.",
      Math.ceil((other.expires_at - now) / 1000),
    );
  // Reserve before password hashing so concurrent requests cannot skip the limit.
  const row = await env.DB.prepare(
    "INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? WHEN count=2 THEN ? ELSE expires_at END WHERE expires_at<=? OR count<3 RETURNING count,expires_at",
  )
    .bind(
      (signup ? "signup-ip:" : "auth-ip:") + key,
      now + WINDOW,
      now,
      now,
      now + WINDOW,
      now + WINDOW,
      now,
    )
    .first<{ count: number; expires_at: number }>();
  if (!row)
    throw new ProtectionError(
      429,
      "Se alcanzaron 3 intentos. Esta IP está bloqueada durante 15 minutos.",
      900,
    );
  return row;
}
export async function releaseSuccessfulLogin(
  env: Env,
  key: string,
  count: number,
) {
  await env.DB.prepare("DELETE FROM request_limits WHERE key=? AND count=?")
    .bind("auth-ip:" + key, count)
    .run();
}
export async function verifyBot(
  request: Request,
  env: Env,
  token: unknown,
  action: string,
) {
  if (env.TURNSTILE_ENABLED !== "true") {
    if (
      !["127.0.0.1", "localhost", "portal.example.test"].includes(
        new URL(env.APP_URL).hostname,
      )
    )
      throw new ProtectionError(
        503,
        "Verificación de seguridad no disponible.",
      );
    return;
  }
  if (
    !env.TURNSTILE_SECRET ||
    typeof token !== "string" ||
    !token ||
    token.length > 2048
  )
    throw new ProtectionError(403, "Completa la verificación de seguridad.");
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: request.headers.get("cf-connecting-ip") || "",
        }),
      },
    );
    if (!response.ok) throw new Error();
    result = await response.json();
  } catch {
    throw new ProtectionError(
      503,
      "No se pudo verificar la seguridad. Intenta nuevamente.",
    );
  }
  if (
    result.success !== true ||
    result.hostname !== new URL(env.APP_URL).hostname ||
    result.action !== action
  )
    throw new ProtectionError(
      403,
      "La verificación venció o no es válida. Intenta nuevamente.",
    );
}
