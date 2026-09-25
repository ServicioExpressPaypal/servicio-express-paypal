import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";

type MailEnv = Pick<Env, "EMAIL_PROVIDER" | "EMAIL_FROM" | "RESEND_API_KEY"> & {
  EMAIL?: SendEmail;
};
type AuthEnv = MailEnv &
  Pick<Env, "APP_URL" | "BETTER_AUTH_SECRET"> & {
    DB: BetterAuthOptions["database"];
  };
export function authOptions(
  env: AuthEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
) {
  const queueEmail = (to: string, subject: string, text: string) => {
    ctx.waitUntil(
      sendMail(env, to, subject, text).catch(() => {
        // Do not log recipient addresses, verification links, or tokens.
        console.error(JSON.stringify({ event: "email_delivery_failed" }));
      }),
    );
  };
  return {
    appName: "Saldo Express",
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        queueEmail(
          user.email,
          "Restablece tu contraseña",
          `Abre este enlace para restablecer tu contraseña: ${url}`,
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        queueEmail(
          user.email,
          "Verifica tu correo",
          `Confirma tu correo de Saldo Express: ${url}`,
        ),
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: env.APP_URL.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-up/email": { window: 600, max: 3 },
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 600, max: 3 },
      },
    },
    plugins: [twoFactor({ issuer: "Saldo Express" })],
  } satisfies BetterAuthOptions;
}
export function createAuth(env: Env, ctx: ExecutionContext) {
  return betterAuth(authOptions(env, ctx));
}
export async function sendMail(
  env: MailEnv,
  to: string,
  subject: string,
  text: string,
) {
  if (env.EMAIL_PROVIDER === "cloudflare" && env.EMAIL) {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to, subject, text });
    return;
  }
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return;
  }
  throw new Error("Email sending unavailable");
}
