import { sendMail } from "./auth";
import { identityKey } from "./protection";

export async function securityEvent(env: Env, event: string, subject = "") {
  const subjectHash = subject
    ? await identityKey(env, "security", subject)
    : "";
  await env.DB.prepare(
    "INSERT INTO security_events(id,event,subject_hash,created_at) VALUES(?,?,?,?)",
  )
    .bind(crypto.randomUUID(), event, subjectHash, Date.now())
    .run();
  console.log(JSON.stringify({ event, subject: subjectHash || undefined }));
}

export async function securityMaintenance(env: Env) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM security_events WHERE created_at<?")
    .bind(now - 30 * 86400000)
    .run();
  const counts = await env.DB.prepare(
    "SELECT event,count(*) AS count FROM security_events WHERE created_at>? GROUP BY event",
  )
    .bind(now - 15 * 60000)
    .all<{ event: string; count: number }>();
  const important = counts.results.filter(
    (r) =>
      (r.event === "server_error" && r.count >= 5) ||
      (r.event === "account_locked" && r.count >= 3) ||
      (r.event === "admin_unlock_failed" && r.count >= 3) ||
      (r.event === "auth_failed" && r.count >= 10) ||
      (r.event === "request_blocked" && r.count >= 20),
  );
  if (
    !important.length ||
    !env.ADMIN_EMAIL ||
    env.EMAIL_PROVIDER === "disabled"
  )
    return;
  const claim = await env.DB.prepare(
    "INSERT INTO security_alerts(id,next_at) VALUES('security',?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE next_at<=? RETURNING id",
  )
    .bind(now + 3600000, now)
    .first();
  if (!claim) return;
  try {
    await sendMail(
      env,
      env.ADMIN_EMAIL,
      "Alerta de seguridad de Saldo Express",
      "Se detectaron eventos de seguridad en los últimos 15 minutos. Revisa el panel de Cloudflare.\n" +
        important.map((r) => `${r.event}: ${r.count}`).join("\n"),
    );
  } catch {
    await env.DB.prepare(
      "UPDATE security_alerts SET next_at=? WHERE id='security'",
    )
      .bind(now + 5 * 60000)
      .run();
    console.error(JSON.stringify({ event: "security_alert_delivery_failed" }));
  }
}

export type DatabaseMetrics = {
  queries: number;
  durationMs: number;
  failures: number;
};
export function instrumentDatabase(
  db: D1Database,
  metrics: DatabaseMetrics,
): D1Database {
  const wrapped = new WeakMap<object, object>();
  function wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property);
        if (typeof value !== "function") return value;
        if (property === "prepare" || property === "bind")
          return (...args: unknown[]) => {
            const real = value.apply(object, args);
            const proxy = wrap(real);
            wrapped.set(proxy, real);
            return proxy;
          };
        if (
          ["all", "first", "run", "raw", "batch", "exec"].includes(
            String(property),
          )
        )
          return async (...args: unknown[]) => {
            if (property === "batch")
              args[0] = (args[0] as object[]).map((s) => wrapped.get(s) || s);
            const start = performance.now();
            metrics.queries +=
              property === "batch" ? (args[0] as unknown[]).length : 1;
            try {
              return await value.apply(object, args);
            } catch (error) {
              metrics.failures++;
              throw error;
            } finally {
              metrics.durationMs += performance.now() - start;
            }
          };
        return value.bind(object);
      },
    });
  }
  return wrap(db);
}
