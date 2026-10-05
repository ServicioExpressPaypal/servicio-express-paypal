import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import CertificateModel from "../public/certificate.js";
import { profileFields } from "./encryption";
import {
  passwordResetDoneMail,
  resetPasswordMail,
  verificationMail,
  type Mail,
} from "./email-templates";

type MailEnv = Pick<
  Env,
  "EMAIL_PROVIDER" | "EMAIL_FROM" | "SUPPORT_EMAIL" | "RESEND_API_KEY"
> & {
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
  // One retry covers a transient failure of the mail provider; the recipient
  // is never logged, only that delivery failed.
  const queueEmail = (to: string, mail: Mail) => {
    ctx.waitUntil(
      (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await sendMailContent(env, to, mail);
            return;
          } catch {
            if (attempt === 0)
              await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
        console.error(JSON.stringify({ event: "email_delivery_failed" }));
      })(),
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
      onPasswordReset: async ({ user }) =>
        queueEmail(user.email, passwordResetDoneMail()),
      sendResetPassword: async ({ user, url }) =>
        queueEmail(user.email, resetPasswordMail(url)),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        queueEmail(user.email, verificationMail(url)),
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
  return betterAuth({
    ...authOptions(env, ctx),
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            if (
              context?.body?.legalAccepted === true &&
              context.body.legalVersion === CertificateModel.version
            ) {
              const now = Date.now();
              const { name: _name, ...body } = context.body;
              const { fullName, ...reviewData } = CertificateModel.registration(
                body,
                now,
              );
              const secured = await profileFields(
                env,
                user.id,
                fullName,
                JSON.stringify(reviewData),
                true,
              );
              await env.DB.batch([
                env.DB.prepare(
                  "INSERT INTO registration_consents(user_id,version,accepted_at) VALUES(?,?,?)",
                ).bind(user.id, CertificateModel.version, now),
                env.DB.prepare(
                  "INSERT INTO profiles(user_id,status,full_name,dossier,updated_at) VALUES(?,'pending',?,?,?)",
                ).bind(user.id, secured.full_name, secured.dossier, now),
              ]);
            }
          },
        },
      },
    },
  });
}
export async function sendMail(
  env: MailEnv,
  to: string,
  subject: string,
  text: string,
  html?: string,
) {
  if (env.EMAIL_PROVIDER === "cloudflare" && env.EMAIL) {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    return;
  }
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        reply_to: env.SUPPORT_EMAIL,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return;
  }
  throw new Error("Email sending unavailable");
}
export const sendMailContent = (env: MailEnv, to: string, mail: Mail) =>
  sendMail(env, to, mail.subject, mail.text, mail.html);
