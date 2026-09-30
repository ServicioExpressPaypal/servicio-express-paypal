import CertificateModel from "../public/certificate.js";

// Customer-facing emails: a short HTML message with one clear button, plus a
// plain-text alternative. No images, scripts, tracking pixels or remote fonts.
export type Mail = { subject: string; text: string; html: string };

type Spec = {
  subject: string;
  preheader: string;
  title: string;
  paragraphs?: string[];
  button?: { label: string; url: string };
  after?: string[];
  quote?: { label: string; value: string };
  small?: string[];
};

const CONTACT = "soporte@saldoexpressnicaragua.com";
const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => escapes[c]);
const multiline = (value: string) => esc(value).replace(/\r?\n/g, "<br>");

const font =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const green = "#267052";
const ink = "#17211c";
const muted = "#5b6b63";
const line = "#dfe5e2";
const page = "#f3f5f4";

function safeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Unsupported email link");
  // The original string is kept so signed tokens are never altered.
  return value;
}

function render(spec: Spec): Mail {
  const link = spec.button ? safeUrl(spec.button.url) : "";
  const paragraphs = spec.paragraphs ?? [];
  const after = spec.after ?? [];
  const small = spec.small ?? [];
  const text = [
    spec.title,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(spec.quote ? [`${spec.quote.label}: ${spec.quote.value}`, ""] : []),
    ...(spec.button ? [`${spec.button.label}:`, link, ""] : []),
    ...after.flatMap((p) => [p, ""]),
    ...small.flatMap((p) => [p, ""]),
    "--",
    `Saldo Express · Responsable: SoftOhm Systems LLC · ${CONTACT}`,
    "Nunca te pediremos tu contraseña ni códigos por correo, WhatsApp o chat.",
  ].join("\n");

  const row = (padding: string, style: string, inner: string) =>
    `<tr><td style="padding:${padding};font-family:${font};${style}">${inner}</td></tr>`;
  const body = (value: string) =>
    row(
      "12px 28px 0",
      `font-size:15px;line-height:1.6;color:${ink};`,
      esc(value),
    );
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(spec.title)}</title></head>
<body style="margin:0;padding:0;background:${page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${page};">${esc(spec.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${line};border-radius:12px;">
${row("24px 28px 0", `font-size:16px;font-weight:700;color:${green};letter-spacing:.2px;`, "Saldo Express")}
${row("14px 28px 0", `font-size:22px;line-height:1.3;font-weight:700;color:${ink};`, esc(spec.title))}
${paragraphs.map(body).join("\n")}
${
  spec.quote
    ? row(
        "16px 28px 0",
        "",
        `<div style="border-left:4px solid ${green};background:${page};padding:12px 14px;border-radius:4px;font-size:15px;line-height:1.5;color:${ink};"><strong>${esc(spec.quote.label)}</strong><br>${multiline(spec.quote.value)}</div>`,
      )
    : ""
}
${
  spec.button
    ? row(
        "22px 28px 0",
        "",
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${green}" style="background:${green};border-radius:8px;"><a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(spec.button.label)}</a></td></tr></table>`,
      ) +
      "\n" +
      row(
        "14px 28px 0",
        `font-size:12px;line-height:1.5;color:${muted};`,
        `Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:${green};word-break:break-all;">${esc(link)}</span>`,
      )
    : ""
}
${after.map(body).join("\n")}
${small
  .map((value) =>
    row(
      "14px 28px 0",
      `font-size:13px;line-height:1.5;color:${muted};`,
      esc(value),
    ),
  )
  .join("\n")}
<tr><td style="padding:22px 28px 24px;"><div style="border-top:1px solid ${line};padding-top:14px;font-family:${font};font-size:12px;line-height:1.6;color:${muted};">Saldo Express · Responsable: SoftOhm Systems LLC · ${CONTACT}<br>Nunca te pediremos tu contraseña ni códigos por correo, WhatsApp o chat.</div></td></tr>
</table>
</td></tr></table>
</body></html>`;
  return {
    subject: spec.subject,
    text,
    html: html.replace(/\n{2,}/g, "\n"),
  };
}

export const verificationMail = (url: string) =>
  render({
    subject: "Verifica tu correo",
    preheader: "Confirma tu correo para continuar con tu solicitud.",
    title: "Confirma tu correo",
    paragraphs: [
      "Gracias por crear tu cuenta en Saldo Express. Confirma tu correo electrónico para continuar.",
    ],
    button: { label: "Confirmar mi correo", url },
    after: [CertificateModel.reviewNotice],
    small: [
      "El enlace vence en 1 hora. Si no creaste esta cuenta, ignora este mensaje.",
    ],
  });

export const resetPasswordMail = (url: string) =>
  render({
    subject: "Restablece tu contraseña",
    preheader: "Elige una nueva contraseña para tu cuenta.",
    title: "Restablece tu contraseña",
    paragraphs: [
      "Recibimos una solicitud para restablecer la contraseña de tu cuenta de Saldo Express. Usa el botón para elegir una nueva.",
    ],
    button: { label: "Elegir nueva contraseña", url },
    small: [
      "El enlace vence en 1 hora. Al cambiar la contraseña cerraremos tus sesiones abiertas.",
      "Si no lo solicitaste, ignora este mensaje: tu contraseña actual sigue siendo válida.",
    ],
  });

export const passwordResetDoneMail = () =>
  render({
    subject: "Tu contraseña fue restablecida",
    preheader: "La contraseña de tu cuenta fue restablecida.",
    title: "Contraseña restablecida",
    paragraphs: [
      "La contraseña de tu cuenta de Saldo Express fue restablecida y cerramos las sesiones anteriores.",
    ],
    small: [`Si no fuiste tú, escribe cuanto antes a ${CONTACT}.`],
  });

export const passwordChangedMail = () =>
  render({
    subject: "Tu contraseña fue cambiada",
    preheader: "Cambiaste la contraseña de tu cuenta.",
    title: "Contraseña cambiada",
    paragraphs: [
      "Cambiaste la contraseña de tu cuenta de Saldo Express y cerramos tus otras sesiones.",
    ],
    small: [`Si no fuiste tú, escribe cuanto antes a ${CONTACT}.`],
  });

const decisionLabels: Record<string, string> = {
  correction: "requiere una corrección",
  active: "fue activada",
  suspended: "fue suspendida",
  closed: "fue cerrada",
};

export function accountDecisionMail(
  status: string,
  reason: string,
  appUrl: string,
) {
  const label = decisionLabels[status] || "fue actualizada";
  const action =
    status === "active"
      ? {
          button: { label: "Abrir mi cuenta", url: appUrl },
          after: ["Ya puedes crear solicitudes desde tu cuenta."],
        }
      : status === "correction"
        ? {
            button: { label: "Corregir mis datos", url: appUrl },
            after: [
              "Entra a tu cuenta para revisar el motivo y enviar tus datos corregidos.",
            ],
          }
        : {};
  return render({
    subject: "Actualización de tu cuenta de Saldo Express",
    preheader: `Tu cuenta ${label}.`,
    title: `Tu cuenta ${label}`,
    quote: { label: "Motivo", value: reason },
    ...action,
    small: [`Si necesitas solicitar una revisión, escribe a ${CONTACT}.`],
  });
}
