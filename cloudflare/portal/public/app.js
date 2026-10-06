import InitialCertificateModel from "./certificate.js?v=20261005-10";
import { toCanvas } from "./qrcode.js?v=20261005-11";
import {
  processingWindow,
  ticketShareText,
  deliveryAmount,
} from "./processing.js?v=20261005-11";

let CertificateModel = InitialCertificateModel;

(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    main = $("#main");
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const themeKey = "saldo-express-theme";
  const currentTheme = () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  function updateThemeControl() {
    const button = $("#theme-toggle");
    if (!button) return;
    const dark = currentTheme() === "dark";
    const label = dark ? "Activar modo claro" : "Activar modo oscuro";
    button.setAttribute("aria-checked", String(dark));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = icon(dark ? "sun" : "moon");
  }
  function setTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    $("#theme-color")?.setAttribute(
      "content",
      theme === "dark" ? "#0f1217" : "#f5f6f8",
    );
    if (persist)
      try {
        localStorage.setItem(themeKey, theme);
      } catch {}
    updateThemeControl();
    icons();
  }
  function bindThemeControl() {
    const button = $("#theme-toggle");
    if (!button) return;
    updateThemeControl();
    button.onclick = () =>
      setTheme(currentTheme() === "dark" ? "light" : "dark");
  }
  function linkifyChatText(value) {
    const text = String(value ?? "");
    const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    let html = "";
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      let label = match[0];
      let trailing = "";
      while (/[.,!?;:]$/.test(label)) {
        trailing = label.slice(-1) + trailing;
        label = label.slice(0, -1);
      }
      const candidate = label.startsWith("www.") ? `https://${label}` : label;
      let url;
      try {
        url = new URL(candidate);
        if (!/^https?:$/.test(url.protocol)) continue;
      } catch {
        continue;
      }
      html += esc(text.slice(last, match.index));
      html += `<a class="chat-message-link" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>${esc(trailing)}`;
      last = match.index + match[0].length;
    }
    return html + esc(text.slice(last));
  }
  const money = (v, currency = "USD") =>
    new Intl.NumberFormat("es-NI", { style: "currency", currency }).format(
      v / 100,
    );
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const labels = {
    submitted: "Nueva",
    reviewing: "En revisión",
    quoted: "Pendiente de pago",
    paid: "Pago confirmado",
    delivered: "Enviado al beneficiario",
    closed: "Cerrada sin confirmación de envío",
    cancelled: "Cancelada",
    expired: "Vencida",
    payment_confirmed: "Pago confirmado por el administrador",
    delivery_confirmed: "Envío al beneficiario confirmado por el administrador",
    certificate_email_sent: "Certificado digital enviado por correo",
  };
  const methodLabel = (mode) =>
    mode === "express" ? "Certificado en efectivo" : "Método internacional";
  const dateTime = (value) =>
    new Intl.DateTimeFormat("es-NI", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Managua",
    }).format(new Date(value));
  const expiryText = (ticket) =>
    ticket.expired
      ? "Venció " + dateTime(ticket.expires_at)
      : "Vence " + dateTime(ticket.expires_at);
  let me,
    config,
    view = "dashboard",
    userFilter = "all",
    historyPage = 1,
    historyQuery = "",
    historyStatus = "all",
    timer;
  let botId,
    botLoading,
    detailExpiry,
    processingTimer,
    ticketRefreshTimer,
    liveChatSocket,
    liveChatRetry,
    liveChatPath,
    liveChatMarker,
    turnTimer;
  const botActions = {
    "/api/auth/sign-up/email": "signup",
    "/api/auth/sign-in/email": "login",
    "/api/auth/request-password-reset": "recover",
    "/api/auth/send-verification-email": "resend",
    "/api/auth/change-password": "password",
    "/api/account/delete": "delete",
    "/api/admin/pin/setup": "admin-pin-setup",
  };
  function mountBot(action) {
    if (!config.turnstileSiteKey) return;
    const container = $("#bot-check");
    if (!container) return;
    if (botId !== undefined && window.turnstile) window.turnstile.remove(botId);
    botId = undefined;
    if (!botLoading)
      botLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    botLoading
      .then(() => {
        if (container.isConnected)
          botId = window.turnstile.render(container, {
            sitekey: config.turnstileSiteKey,
            action,
            size: "flexible",
            theme: currentTheme(),
          });
      })
      .catch(() =>
        toast(
          "No se pudo cargar la verificación de seguridad. Recarga la página.",
        ),
      );
  }
  const params = new URLSearchParams(location.search);
  let requestedTicket = /^SE-[A-F0-9-]+$/.test(params.get("ticket") || "")
    ? params.get("ticket")
    : null;
  const resetToken = params.get("token");
  let setupMode = params.get("setup") === "1";
  let inviteToken = new URLSearchParams(location.hash.slice(1)).get("invite");
  if (location.search || location.hash)
    history.replaceState(null, "", location.pathname);
  function icons() {
    window.lucide?.createIcons();
  }
  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    clearTimeout(timer);
    timer = setTimeout(() => $("#toast").classList.remove("visible"), 7000);
  }
  async function api(path, body) {
    if (body && botActions[path] && config?.turnstileSiteKey) {
      const token =
        botId !== undefined ? window.turnstile?.getResponse(botId) : "";
      if (!token) throw new Error("Completa la verificación de seguridad.");
      body = { ...body, turnstileToken: token };
    }
    let response;
    try {
      response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers:
          body instanceof FormData
            ? {}
            : body instanceof Blob
              ? { "content-type": body.type }
              : { "content-type": "application/json" },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData || body instanceof Blob
              ? body
              : JSON.stringify(body),
      });
    } finally {
      if (body && botActions[path] && botId !== undefined)
        window.turnstile?.reset(botId);
    }
    const data = await response.json().catch(() => ({
      error: "No se pudo completar la solicitud. Intenta de nuevo más tarde.",
    }));
    if (!response.ok)
      throw new Error(
        {
          INVALID_EMAIL_OR_PASSWORD:
            "El correo o la contraseña no son correctos.",
          EMAIL_NOT_VERIFIED: "Verifica tu correo antes de entrar.",
          INVALID_PASSWORD: "La contraseña actual no es correcta.",
          SESSION_EXPIRED:
            "Por seguridad, vuelve a iniciar sesión y reintenta.",
        }[data.code] ||
          data.error ||
          data.message ||
          "No se pudo completar la solicitud.",
      );
    return data;
  }
  function form(id, html, submitLabel) {
    return `<form id="${id}" class="stack">${html}<p class="form-error" role="alert"></p><button type="submit" class="button primary">${submitLabel}</button></form>`;
  }
  const field = (label, name, type = "text", attrs = "") =>
    `<label class="field">${label}<input name="${name}" type="${type}" required ${attrs}></label>`;
  function bind(id, handler) {
    const f = $("#" + id);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = f.querySelector('[type="submit"]');
      b.disabled = true;
      try {
        await handler(new FormData(f));
      } catch (err) {
        f.querySelector('[role="alert"]').textContent = err.message;
      } finally {
        b.disabled = false;
      }
    };
  }
  function modal(title, html) {
    $("#dialog-title").textContent = title;
    $("#dialog-body").innerHTML = html;
    $("#dialog").showModal();
    icons();
  }
  $("#close-dialog").onclick = () => $("#dialog").close();
  function legalNotice() {
    modal(
      "Términos y privacidad",
      `<p>La cuenta requiere verificar el correo y aprobación manual. Los datos de destino se usan temporalmente en cada ticket.</p>
       <p><a href="/terminos.html" target="_blank" rel="noopener">Términos y condiciones</a></p>
       <p><a href="/privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a></p>
       <p>SoftOhm Systems LLC · <a href="mailto:${CertificateModel.supportEmail}">${CertificateModel.supportEmail}</a></p>`,
    );
  }
  $("#privacy-notice").onclick = legalNotice;
  async function refresh() {
    config = await api("/api/config");
    try {
      me = await api("/api/me");
    } catch {
      me = null;
    }
    render();
  }
  function nav() {
    $("#navigation").innerHTML = !me
      ? ""
      : `${me.admin ? '<button class="nav" data-view="dashboard">Resumen</button><button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="accounting">Contabilidad</button><button class="nav" data-view="users">Usuarios</button>' : '<button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="history">Historial</button><button class="nav" data-view="settings">Ajustes</button>'}<span class="session-actions"><button class="icon-button theme-toggle" id="theme-toggle" type="button" role="switch" aria-checked="false"></button><button class="icon-button" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("log-out")}</button></span>`;
    bindThemeControl();
    if ($("#logout"))
      $("#logout").onclick = async () => {
        await api("/api/auth/sign-out", {});
        me = null;
        render();
      };
    document.querySelectorAll("[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
      b.onclick = () => {
        view = b.dataset.view;
        if (view === "users") userFilter = "all";
        render();
      };
    });
  }
  async function render() {
    closeLiveChat();
    clearInterval(turnTimer);
    clearInterval(ticketRefreshTimer);
    clearInterval(processingTimer);
    clearTimeout(detailExpiry);
    stopWatchingTickets();
    main.className = "";
    if (me && !me.admin && view === "dashboard") view = "tickets";
    nav();
    if (resetToken) return login();
    if (!me && setupMode) return adminSetup();
    if (!me) return login();
    if (me.admin && !me.adminReady) return security();
    try {
      if (requestedTicket) {
        const id = requestedTicket;
        requestedTicket = null;
        await detail(id);
        return;
      }
      if (me.admin && view === "users") await users();
      else if (me.admin && view === "dashboard") await dashboard();
      else if (me.admin && view === "accounting") await accounting();
      else if (!me.admin && view === "settings") settings();
      else if (!me.admin && view === "history") await ticketHistory();
      else if (
        !me.admin &&
        (view === "profile" || me.profile.status !== "active")
      )
        profile();
      else await tickets();
      icons();
    } catch (err) {
      main.innerHTML = `<div class="onboarding"><h1>No pudimos cargar los datos</h1><p>${esc(err.message)}</p><button class="button" id="retry">Volver a intentar</button></div>`;
      $("#retry").onclick = refresh;
    }
  }
  function adminSetup() {
    main.innerHTML = `<div class="onboarding"><h1>${inviteToken ? "Crea tu acceso" : "Acceso de administrador"}</h1>${form("admin-setup", inviteToken ? `${field("Nombre completo", "name", "text", 'autocomplete="name" minlength="2" maxlength="120"')}${field("Contraseña", "password", "password", 'autocomplete="new-password" minlength="12" maxlength="128"')}${field("Repite la contraseña", "confirmation", "password", 'autocomplete="new-password" minlength="12" maxlength="128"')}` : "", inviteToken ? "Crear mi cuenta" : "Enviar invitación")}<button class="text-button" id="setup-login">Ya tengo cuenta</button></div>`;
    $("#setup-login").onclick = () => {
      setupMode = false;
      inviteToken = null;
      login();
    };
    bind("admin-setup", async (f) => {
      if (!inviteToken) {
        await api("/api/setup/request", {});
        toast(
          "La invitación se envía únicamente al correo del administrador. Si ya tienes cuenta, inicia sesión.",
        );
        return;
      }
      if (f.get("password") !== f.get("confirmation"))
        throw new Error("Las contraseñas no coinciden.");
      await api("/api/setup/complete", {
        token: inviteToken,
        name: f.get("name"),
        password: f.get("password"),
      });
      inviteToken = null;
      setupMode = false;
      login();
      toast(
        "Cuenta creada. Verifica el enlace enviado a tu correo antes de entrar.",
      );
    });
  }
  function contactFields(p = {}) {
    return `${field("Nombre completo", "fullName", "text", `autocomplete="name" minlength="5" maxlength="120" value="${esc(p.name || "")}"`)}${field("Teléfono de contacto", "phone", "tel", `autocomplete="tel" maxlength="30" placeholder="+ código de país y número" value="${esc(p.phone || "")}"`)}`;
  }
  function recoverSentHtml(email) {
    return `<p class="notice recover-sent"><strong>Te enviamos un enlace de recuperación</strong> a <strong>${esc(email)}</strong>, si existe una cuenta con ese correo.</p><ul class="recover-tips"><li>El enlace vence en 1 hora y solo se puede usar una vez.</li><li>Puede tardar unos minutos. Revisa también spam o promociones.</li><li>Si no llega, espera unos minutos y pide otro enlace.</li></ul>`;
  }
  function recoverSent(email) {
    main.className = "auth-view";
    main.innerHTML = `<div class="onboarding" role="status"><h1>Revisa tu correo</h1>${recoverSentHtml(email)}<button class="button" id="recover-back">Volver a ingresar</button><button class="text-button" id="recover-again">Pedir otro enlace</button></div>`;
    $("#recover-back").onclick = () => login();
    $("#recover-again").onclick = () => login("recover");
  }
  function login(mode = "login") {
    const reset = !!resetToken;
    main.className = "auth-view";
    main.innerHTML = `<div class="onboarding"><h1>${reset ? "Nueva contraseña" : mode === "signup" ? "Crea tu cuenta" : mode === "recover" ? "Recupera tu acceso" : "Ingresar"}</h1>${!reset ? `<div class="auth-tabs" role="tablist"><button role="tab" data-auth="login" aria-selected="${mode === "login"}">Ingresar</button><button role="tab" data-auth="signup" aria-selected="${mode === "signup"}">Crear cuenta</button></div>` : ""}${mode === "signup" && !config.registrationOpen ? '<div class="notice">El registro de nuevas cuentas todavía no está abierto.</div>' : form("auth", `${!reset ? field("Correo electrónico", "email", "email", 'autocomplete="email" maxlength="254"') : ""}${mode !== "recover" ? field("Contraseña", "password", "password", `minlength="12" maxlength="128" autocomplete="${reset || mode === "signup" ? "new-password" : "current-password"}"`) : ""}`, reset ? "Guardar contraseña" : mode === "signup" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Entrar")}${!reset ? '<button class="text-button" id="recover">Olvidé mi contraseña</button>' : ""}</div>`;
    if (mode === "signup" && !reset) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = CertificateModel.reviewNotice;
      ($(".auth-tabs") || $(".onboarding h1")).after(note);
      if ($("#auth"))
        $("#auth").insertAdjacentHTML("afterbegin", contactFields());
    }
    document
      .querySelectorAll("[data-auth]")
      .forEach((b) => (b.onclick = () => login(b.dataset.auth)));
    if ($("#recover")) $("#recover").onclick = () => login("recover");
    if ($("#auth") && !reset) {
      if (mode === "signup")
        $("#auth button[type=submit]").insertAdjacentHTML(
          "beforebegin",
          '<label class="check"><input name="legalAccepted" type="checkbox" required><span>Soy mayor de edad y acepto los <a href="/terminos.html" target="_blank" rel="noopener">términos</a> y el <a href="/privacidad.html" target="_blank" rel="noopener">aviso de privacidad</a>.</span></label>',
        );
      $("#auth button[type=submit]").insertAdjacentHTML(
        "beforebegin",
        '<div id="bot-check"></div>',
      );
      mountBot(
        mode === "signup" ? "signup" : mode === "recover" ? "recover" : "login",
      );
    }
    if ($("#auth"))
      bind("auth", async (f) => {
        let result;
        if (reset) {
          await api("/api/auth/reset-password", {
            token: resetToken,
            newPassword: f.get("password"),
          });
          location.replace("/");
          return;
        }
        if (mode === "recover") {
          const submit = $("#auth button[type=submit]");
          submit.textContent = "Enviando enlace…";
          try {
            await api("/api/auth/request-password-reset", {
              email: f.get("email"),
              redirectTo: location.origin + "/",
            });
          } catch (error) {
            submit.textContent = "Enviar enlace";
            throw error;
          }
          recoverSent(String(f.get("email")).trim());
          return;
        }
        if (mode === "signup") {
          await api("/api/auth/sign-up/email", {
            email: f.get("email"),
            password: f.get("password"),
            name: "Cliente",
            fullName: f.get("fullName"),
            phone: f.get("phone"),
            legalAccepted: f.get("legalAccepted") === "on",
            legalVersion: CertificateModel.version,
            callbackURL: location.origin + "/",
          });
          verification(f.get("email"));
          return;
        }
        result = await api("/api/auth/sign-in/email", {
          email: f.get("email"),
          password: f.get("password"),
        });
        if (result.twoFactorRedirect) challenge();
        else await refresh();
      });
    icons();
  }
  function verification(email) {
    main.innerHTML = `<div class="onboarding"><h1>Verifica tu correo</h1><p>${esc(email)}</p><p>Revisa el enlace que enviamos a tu correo.</p><button class="button" id="resend">Reenviar correo</button><button class="text-button" id="back-login">Iniciar sesión</button></div>`;
    $("#resend").insertAdjacentHTML(
      "beforebegin",
      '<div id="bot-check"></div>',
    );
    mountBot("resend");
    $("#resend").onclick = async () => {
      try {
        await api("/api/auth/send-verification-email", {
          email,
          callbackURL: location.origin + "/",
        });
        toast("Revisa tu correo.");
      } catch (e) {
        toast(e.message);
      }
    };
    $("#back-login").onclick = () => login();
  }
  function challenge(backup = false) {
    main.innerHTML = `<div class="onboarding"><h1>Verifica tu acceso</h1>${form("mfa", field(backup ? "Código de recuperación" : "Código del autenticador", "code", "text", backup ? 'autocomplete="off"' : 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}"'), "Verificar")}<button class="text-button" id="backup">${backup ? "Usar autenticador" : "Usar código de recuperación"}</button></div>`;
    $("#backup").onclick = () => challenge(!backup);
    bind("mfa", async (f) => {
      await api(
        "/api/auth/two-factor/" +
          (backup ? "verify-backup-code" : "verify-totp"),
        { code: f.get("code"), trustDevice: false },
      );
      await refresh();
    });
  }
  function security(backup = false) {
    if (me.adminSecurityMode === "pin") {
      if (!me.adminPinConfigured) {
        main.innerHTML = `<div class="onboarding"><h1>Crea tu PIN administrativo</h1><p>Este PIN será solicitado además de tu contraseña para abrir el panel. No uses fechas ni secuencias fáciles.</p>${form("pin-setup", `${field("Contraseña actual", "password", "password", 'autocomplete="current-password" maxlength="128"')}${field("PIN de 6 dígitos", "pin", "password", 'inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password"')}${field("Repite el PIN", "confirmation", "password", 'inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password"')}<div id="bot-check"></div>`, "Guardar PIN y abrir panel")}</div>`;
        mountBot("admin-pin-setup");
        bind("pin-setup", async (formData) => {
          await api("/api/admin/pin/setup", {
            password: formData.get("password"),
            pin: formData.get("pin"),
            confirmation: formData.get("confirmation"),
          });
          await refresh();
        });
        return;
      }
      main.innerHTML = `<div class="onboarding"><h1>Acceso de administrador</h1><p>Introduce tu PIN de seguridad. El acceso administrativo permanecerá abierto durante 15 minutos.</p>${form("pin-unlock", field("PIN de 6 dígitos", "code", "password", 'inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code"'), "Abrir panel")}</div>`;
      bind("pin-unlock", async (formData) => {
        await api("/api/admin/unlock", { code: formData.get("code") });
        await refresh();
      });
      return;
    }
    if (!me.twoFactorEnabled) {
      main.innerHTML = `<div class="onboarding"><h1>Protege tu acceso</h1>${form("enable", field("Confirma tu contraseña", "password", "password", 'autocomplete="current-password"'), "Configurar autenticador")}</div>`;
      bind("enable", async (f) => {
        const data = await api("/api/auth/two-factor/enable", {
          password: f.get("password"),
        });
        const key = new URL(data.totpURI).searchParams.get("secret");
        main.innerHTML = `<div class="onboarding"><h1>Vincula tu autenticador</h1><p>Escaneá este QR desde tu aplicación de autenticación.</p><canvas id="mfa-qr" class="mfa-qr" aria-label="QR para configurar el autenticador"></canvas><details><summary>Ingresar clave manualmente</summary><p class="mfa-secret">${esc(key)}</p></details><details><summary>Códigos de recuperación</summary><p class="mfa-secret">${data.backupCodes.map(esc).join("<br>")}</p></details><button type="button" class="button" id="save-backup">${icon("download")}Guardar códigos</button>${form("confirm", `<label class="check"><input type="checkbox" required>Guardé mis códigos de recuperación en un lugar seguro.</label>${field("Código de 6 dígitos de la aplicación", "code", "text", 'inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code"')}`, "Activar doble factor")}</div>`;
        await toCanvas($("#mfa-qr"), data.totpURI, { width: 224, margin: 2 });
        $("#save-backup").onclick = () => {
          const url = URL.createObjectURL(
            new Blob(
              [
                "Saldo Express - Codigos de recuperacion\nCada codigo es de un solo uso.\n\n" +
                  data.backupCodes.join("\n"),
              ],
              { type: "text/plain" },
            ),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "saldo-express-recuperacion.txt";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        icons();
        bind("confirm", async (f) => {
          await api("/api/auth/two-factor/verify-totp", {
            code: f.get("code"),
          });
          await refresh();
        });
      });
      return;
    }
    main.innerHTML = `<div class="onboarding"><h1>Acceso de administrador</h1>${form("unlock", field(backup ? "Código de recuperación" : "Código del autenticador", "code", "text", backup ? 'autocomplete="off" maxlength="32"' : 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"'), "Abrir panel")}<button class="text-button" id="unlock-backup">${backup ? "Usar autenticador" : "Usar código de recuperación"}</button></div>`;
    $("#unlock-backup").onclick = () => security(!backup);
    bind("unlock", async (f) => {
      await api("/api/admin/unlock", { code: f.get("code"), backup });
      await refresh();
    });
  }
  function profile() {
    const p = me.profile;
    main.innerHTML = `<div class="onboarding"><h1>Mi cuenta</h1><p>${esc(me.user.email)}</p><span class="badge">${esc(AccountModel.labels[p.status])}</span>${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}${p.status === "pending" ? `<p>${esc(CertificateModel.reviewNotice)}</p>` : p.status === "active" ? `<p>${esc(p.name)}</p>` : !config.kycOpen ? '<div class="notice">La recepción de datos para revisión todavía no está habilitada.</div>' : ""}</div>`;
    $(".onboarding").insertAdjacentHTML(
      "beforeend",
      '<button class="button" id="open-settings">Ver ajustes de mi cuenta</button>',
    );
    $("#open-settings").onclick = () => {
      view = "settings";
      render();
    };
    if (!config.kycOpen || !["incomplete", "correction"].includes(p.status))
      return;
    main.innerHTML = `<div class="onboarding"><h1>Solicita la activación</h1>${form("profile", `${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}<p>${esc(CertificateModel.reviewNotice)}</p>${contactFields(p)}<label class="check"><input type="checkbox" name="declaration" required>Declaro que soy mayor de edad.</label><label class="check"><input type="checkbox" name="terms" required>Acepto los términos y condiciones.</label><label class="check"><input type="checkbox" name="privacy" required>He leído el aviso de privacidad.</label><button type="button" class="text-button" id="legal">Términos y privacidad</button>`, "Enviar a revisión")}</div>`;
    $("#legal").onclick = legalNotice;
    bind("profile", async (f) => {
      await api("/api/profile", {
        ...Object.fromEntries(f),
        version: CertificateModel.version,
      });
      await refresh();
    });
  }
  function settings() {
    const p = me.profile;
    main.innerHTML = `<div class="heading"><h1>Ajustes</h1><span class="badge">${esc(AccountModel.labels[p.status])}</span></div>
      <section class="settings-section"><div><h2>Mi cuenta</h2><p class="muted">Tu acceso a Saldo Express.</p></div><div>
        <dl class="account-data"><div><dt>Nombre completo</dt><dd>${esc(p.name || "No registrado")}</dd></div><div><dt>Teléfono de contacto</dt><dd>${esc(p.phone || "No registrado")}</dd></div><div><dt>Correo electrónico</dt><dd>${esc(me.user.email)}</dd></div><div><dt>Verificación</dt><dd>${me.user.emailVerified ? "Correo verificado" : "Pendiente"}</dd></div><div><dt>Cuenta creada</dt><dd>${dateTime(me.user.createdAt)}</dd></div><div><dt>Estado</dt><dd>${esc(AccountModel.labels[p.status])}</dd></div>${me.consent ? `<div><dt>Aceptación de condiciones</dt><dd>${dateTime(me.consent.accepted_at)}<small>${esc(me.consent.version)}</small></dd></div>` : ""}</dl>
        ${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}${p.status === "pending" ? `<p class="notice">${esc(CertificateModel.reviewNotice)}</p>` : ""}
        <a class="text-button" href="mailto:${CertificateModel.supportEmail}">Solicitar corrección de mis datos</a>
      </div></section>
      <section class="settings-section"><div><h2>Contraseña</h2><p class="muted">Al cambiarla, se cerrarán las otras sesiones.</p></div><div class="settings-actions"><button class="button" id="change-password">${icon("key-round")}Cambiar contraseña</button><button class="text-button" id="reset-password">Recibir enlace de recuperación</button></div></section>
      <section class="settings-section"><div><h2>Privacidad</h2></div><div><p>Los datos de destino y los comentarios del ticket se eliminan al vencer o cerrarse. El historial conserva montos, estados y condiciones aceptadas.</p><a href="/privacidad.html" target="_blank" rel="noopener">Ver aviso de privacidad</a></div></section>
      <section class="settings-section danger-section"><div><h2>Eliminar cuenta</h2><p class="muted">Esta acción es permanente.</p></div><div><p>Se eliminarán tu cuenta, sesiones, tickets, comentarios y aceptaciones de la base activa. Las cotizaciones vigentes y entregas pendientes deben resolverse primero.</p><button class="button danger" id="delete-account">${icon("trash-2")}Eliminar mi cuenta</button></div></section>`;
    $("#change-password").onclick = () => {
      modal(
        "Cambiar contraseña",
        form(
          "password-change",
          field(
            "Contraseña actual",
            "currentPassword",
            "password",
            'autocomplete="current-password" maxlength="128"',
          ) +
            field(
              "Nueva contraseña",
              "newPassword",
              "password",
              'autocomplete="new-password" minlength="12" maxlength="128"',
            ) +
            '<p class="field-hint">Usa al menos 12 caracteres.</p>' +
            field(
              "Repite la nueva contraseña",
              "confirmation",
              "password",
              'autocomplete="new-password" minlength="12" maxlength="128"',
            ) +
            '<div id="bot-check"></div>',
          "Guardar contraseña",
        ),
      );
      mountBot("password");
      bind("password-change", async (f) => {
        if (f.get("newPassword") !== f.get("confirmation"))
          throw new Error("Las contraseñas no coinciden.");
        if (f.get("newPassword") === f.get("currentPassword"))
          throw new Error("Elige una contraseña distinta a la actual.");
        await api("/api/auth/change-password", {
          currentPassword: f.get("currentPassword"),
          newPassword: f.get("newPassword"),
          revokeOtherSessions: true,
        });
        $("#dialog").close();
        toast("Contraseña actualizada. Se cerraron las otras sesiones.");
      });
    };
    $("#reset-password").onclick = () => {
      modal(
        "Recuperar contraseña",
        form(
          "password-email",
          `<p>Enviaremos un enlace a <strong>${esc(me.user.email)}</strong>.</p><div id="bot-check"></div>`,
          "Enviar enlace",
        ),
      );
      mountBot("recover");
      bind("password-email", async () => {
        const submit = $("#password-email button[type=submit]");
        submit.textContent = "Enviando enlace…";
        try {
          await api("/api/auth/request-password-reset", {
            email: me.user.email,
            redirectTo: location.origin + "/",
          });
        } catch (error) {
          submit.textContent = "Enviar enlace";
          throw error;
        }
        $("#dialog-title").textContent = "Revisa tu correo";
        $("#dialog-body").innerHTML =
          `<div role="status">${recoverSentHtml(me.user.email)}</div><button class="button" type="button" id="recover-done">Entendido</button>`;
        $("#recover-done").onclick = () => $("#dialog").close();
      });
    };
    $("#delete-account").onclick = () => {
      modal(
        "Eliminar mi cuenta",
        form(
          "account-delete",
          `<p>Perderás el acceso a tu cuenta y a todo tu historial. Esta acción no cancela pagos ni elimina copias de correos o WhatsApp.</p><p>Las copias técnicas de recuperación y los eventos seudonimizados de seguridad pueden conservarse hasta 30 días. Si existen documentos antiguos, su borrado se reintentará automáticamente hasta completarse.</p>${field("Contraseña actual", "password", "password", 'autocomplete="current-password" maxlength="128"')}${field("Escribe ELIMINAR para confirmar", "confirmation", "text", 'autocomplete="off" pattern="ELIMINAR"')}<label class="check"><input type="checkbox" name="acknowledge" required>Entiendo que perderé mi cuenta y mi historial.</label><div id="bot-check"></div>`,
          "Eliminar definitivamente",
        ),
      );
      $("#account-delete button[type=submit]").classList.add("danger");
      mountBot("delete");
      bind("account-delete", async (f) => {
        await api("/api/account/delete", {
          password: f.get("password"),
          confirmation: f.get("confirmation"),
        });
        await api("/api/auth/sign-out", {}).catch(() => {});
        $("#dialog").close();
        me = null;
        view = "dashboard";
        render();
        toast("Tu cuenta y su historial fueron eliminados de la base activa.");
      });
    };
  }
  function historyRow(t) {
    const tracking = processingWindow(t);
    return `<button class="ticket-row" data-ticket="${esc(t.id)}"><span><strong>${money(t.amount)}</strong> · ${methodLabel(t.mode)}<small>Monto del certificado · ${t.delivery_amount ? `Importe enviado ${money(t.delivery_amount.received, t.delivery_amount.currency)}` : t.quote ? `Importe acordado ${money(t.quote.received, t.currency)}` : `Valor estimado a entregar ${money(t.estimate.net)}`}</small><small>${dateTime(t.created_at)}</small><small class="ticket-id">${esc(t.id)}</small>${t.certificate_code ? `<small class="certificate-code-inline">${esc(t.certificate_code)}</small>` : ""}${tracking && t.processing_started_at ? `<small>${t.processing_completed_at ? "Envío confirmado" : "Entrega en proceso"}</small>` : ""}</span><span class="badge ${esc(t.status)}">${esc(labels[t.status])}</span></button>`;
  }
  async function ticketHistory() {
    const params = new URLSearchParams({
      page: String(historyPage),
      q: historyQuery,
      status: historyStatus,
    });
    const result = await api("/api/account/history?" + params);
    const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
    main.innerHTML = `<div class="heading"><h1>Historial</h1><span class="muted">${result.total} solicitudes</span></div>
      <form id="history-search" class="history-filters"><label class="field">Número de ticket<input type="search" name="query" maxlength="80" value="${esc(historyQuery)}" placeholder="SE-…"></label><label class="field">Estado<select name="status">${Object.entries(
        {
          all: "Todos",
          active: "Vigentes o en proceso",
          expired: "Vencidos",
          paid: "Pago confirmado",
          delivered: "Enviados al beneficiario",
          closed: "Cerrados anteriormente",
          cancelled: "Cancelados",
        },
      )
        .map(
          ([key, label]) =>
            `<option value="${key}" ${key === historyStatus ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><button class="button" type="submit">${icon("search")}Buscar</button></form>
      <div class="ticket-list">${result.items.length ? result.items.map(historyRow).join("") : '<p class="empty">No hay solicitudes con estos filtros.</p>'}</div>
      <div class="history-pagination"><button class="icon-button" id="previous-page" aria-label="Página anterior" title="Página anterior" ${historyPage <= 1 ? "disabled" : ""}>${icon("chevron-left")}</button><span>Página ${historyPage} de ${pages}</span><button class="icon-button" id="next-page" aria-label="Página siguiente" title="Página siguiente" ${historyPage >= pages ? "disabled" : ""}>${icon("chevron-right")}</button></div>`;
    $("#history-search").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      historyQuery = String(f.get("query")).trim();
      historyStatus = String(f.get("status"));
      historyPage = 1;
      render();
    };
    $("#previous-page").onclick = () => {
      historyPage--;
      render();
    };
    $("#next-page").onclick = () => {
      historyPage++;
      render();
    };
    document
      .querySelectorAll("[data-ticket]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            detail(b.dataset.ticket).catch((e) => toast(e.message))),
      );
    watchTickets(
      result.items
        .filter((t) => !t.processing_completed_at && !t.expired)
        .map((t) => t.id),
      async () => {
        const current = await api("/api/account/history?" + params);
        return (
          listSignature(current.items, current.total) !==
          listSignature(result.items, result.total)
        );
      },
    );
  }
  async function tickets() {
    main.className = me.admin ? "admin-tickets" : "customer-tickets";
    let recent = { items: [], total: 0 };
    let rows;
    if (me.admin) rows = await api("/api/admin/tickets");
    else {
      const [active, finished, latestConfig] = await Promise.all([
        api("/api/account/history?status=active"),
        api("/api/account/history?status=recent"),
        api("/api/config"),
      ]);
      rows = active.items;
      recent = finished;
      config = { ...config, ...latestConfig };
    }
    main.innerHTML = `<div class="heading"><h1>${me.admin ? "Solicitudes" : "Mis solicitudes"}</h1>${!me.admin ? `<button class="button primary" id="new-ticket">${icon("plus")}Nueva solicitud</button>` : ""}</div><div class="ticket-list">${rows.length ? rows.map((t) => `<button class="ticket-row" data-ticket="${t.id}"><span><strong>${money(t.amount)}</strong> · ${methodLabel(t.mode)}<small>Monto del certificado · Valor estimado a entregar ${money(t.estimate.net)}</small><small>${esc(t.beneficiary_name || t.full_name || t.bank)} · ${new Date(t.created_at).toLocaleDateString("es-NI")}</small><small class="ticket-expiry">${esc(expiryText(t))}</small><small class="ticket-id">${esc(t.id)}</small></span><span class="badge ${t.status}">${labels[t.status]}</span></button>`).join("") : `<p class="empty">${me.admin ? "Todavía no hay solicitudes." : "No tienes solicitudes vigentes. Elige un certificado arriba para crear una."}</p>`}</div>`;
    if (!me.admin) {
      const intakeOpen = config.ticketIntakeOpen !== false;
      const cards = CertificateModel.presetAmounts
        .map((amount) => {
          const estimate = SaldoCalculator.estimate(amount * 100, "express");
          return `<article class="gift-option"><div class="gift-face"><img class="gift-ribbon" src="/gift-ribbon.png" alt=""><div class="gift-title"><span>CERTIFICADO DE REGALO</span><h2>Efectivo</h2><small>Un detalle para compartir con quien elijas.</small></div><div class="gift-stub"><span>Monto del certificado</span><strong>$${amount}</strong><small>USD</small></div></div><div class="gift-summary"><span>Valor estimado a entregar<strong>${money(estimate.net)}</strong></span><span>Costos estimados<strong>${money(estimate.total)}</strong></span></div><button type="button" class="gift-select" data-preset="${amount}" aria-label="Elegir certificado de ${amount} dólares" ${intakeOpen ? "" : "disabled"}>${intakeOpen ? `Elegir $${amount} USD ${icon("arrow-right")}` : "Sin disponibilidad"}</button></article>`;
        })
        .join("");
      $(".heading").outerHTML =
        `<div class="heading gift-heading"><div><h1>Certificados de regalo</h1><p>Un detalle para tu familia.</p></div><button type="button" class="button" id="new-ticket" ${intakeOpen ? "" : "disabled"}>${icon("plus")}Ticket personalizado</button></div>${intakeOpen ? "" : '<div class="intake-unavailable notice" role="status"><strong>Capacidad de solicitudes alcanzada</strong><p>Por el momento no podemos recibir nuevos tickets. Los que ya están en proceso continúan normalmente. Vuelve a consultar más tarde.</p></div>'}<section class="gift-catalog" aria-label="Montos disponibles"><div class="gift-grid">${cards}</div></section><h2 class="ticket-list-title">Solicitudes vigentes o en proceso</h2>`;
      document.querySelectorAll("[data-preset]").forEach((button) => {
        button.onclick = () => newTicket(Number(button.dataset.preset));
      });
    }
    if ($("#new-ticket")) $("#new-ticket").onclick = () => newTicket();
    if (!me.admin) {
      $(".ticket-list").insertAdjacentHTML(
        "afterend",
        `<section class="recent-certificates" aria-labelledby="recent-title"><div class="recent-heading"><h2 id="recent-title">Certificados recientes</h2><p>Pagados, enviados y cancelados. Aquí no cuentan como solicitudes vigentes.</p></div><div class="ticket-list" id="recent-list">${recent.items.length ? recent.items.map(historyRow).join("") : '<p class="empty">Todavía no tienes certificados pagados, enviados o cancelados. Cuando el pago se confirme, aparecerán aquí.</p>'}</div><button class="text-button" id="all-history">${recent.total > recent.items.length ? `Ver todo el historial (${recent.total})` : "Ver todo el historial"}</button></section>`,
      );
      $("#all-history").onclick = () => {
        view = "history";
        historyPage = 1;
        historyStatus = "all";
        historyQuery = "";
        render();
      };
    }
    document
      .querySelectorAll("[data-ticket]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            detail(b.dataset.ticket).catch((e) => toast(e.message))),
      );
    if (me.admin) {
      const snapshot = listSignature(rows);
      watchTickets(
        [],
        async () => listSignature(await api("/api/admin/tickets")) !== snapshot,
        "/api/admin/live",
      );
    } else {
      const snapshot = listSignature(
        [...rows, ...recent.items],
        rows.length + recent.total,
      );
      watchTickets(
        rows.map((t) => t.id),
        async () => {
          const [active, finished] = await Promise.all([
            api("/api/account/history?status=active"),
            api("/api/account/history?status=recent"),
          ]);
          return (
            listSignature(
              [...active.items, ...finished.items],
              active.total + finished.total,
            ) !== snapshot
          );
        },
      );
    }
  }
  function newTicket(presetAmount) {
    if (config.ticketIntakeOpen === false) {
      toast(
        "Se alcanzó la capacidad disponible de solicitudes. Intenta nuevamente más tarde.",
      );
      render();
      return;
    }
    main.className = "ticket-create-view";
    const requestKey = crypto.randomUUID();
    const conditions = CertificateModel.ticketConditions
      .map((condition) => `<li>${esc(condition)}</li>`)
      .join("");
    main.innerHTML = `<div class="onboarding ticket-create"><h1>${esc(CertificateModel.title)}</h1><p>${esc(CertificateModel.description)}</p><p class="notice">Express: 24 horas de vigencia. Internacional: 6 días hábiles; si se confirma el pago durante la vigencia, se cuentan desde esa confirmación. La atención y la confirmación se coordinan en el chat del ticket.</p>${form("ticket", `${field("Monto del certificado (USD)", "amount", "number", 'min="25" max="3000" step="0.01"')}<p class="field-hint">Método Express: máximo USD 500 por ticket. Los montos mayores se clasifican automáticamente como Método internacional.</p><fieldset class="ticket-destination"><legend>Datos del beneficiario</legend>${field("Nombre completo de la persona", "beneficiaryName", "text", 'autocomplete="off" minlength="5" maxlength="120"')}${field("Número de cuenta bancaria", "bankAccount", "text", 'inputmode="numeric" autocomplete="off" minlength="6" maxlength="40"')}<div class="field-pair"><label class="field">Banco<select name="bank" required><option value="">Selecciona</option>${CertificateModel.banks.map((b) => `<option>${esc(b)}</option>`).join("")}</select></label><label class="field">Moneda de la cuenta<select name="currency" required><option value="">Selecciona</option><option value="USD">Dólares</option><option value="NIO">Córdobas</option></select></label></div></fieldset><div class="estimate" id="estimate">Ingresa el monto para calcular los costos y la entrega estimada.</div><section class="ticket-conditions" aria-labelledby="ticket-conditions-title"><h2 id="ticket-conditions-title">Condiciones de la solicitud</h2><ul>${conditions}</ul></section><label class="check"><input name="paypalOwnership" type="checkbox" required>Declaro que utilizaré una cuenta de PayPal propia, a mi nombre.</label><label class="check"><input name="conditionsAccepted" type="checkbox" required>Confirmo que soy mayor de edad, revisé los datos bancarios y acepto estas condiciones.</label><label class="check"><input name="consent" type="checkbox" required>Solicito atención mediante este ticket y acepto su vigencia según la modalidad y las condiciones de compra y reembolsos. Crear el ticket no confirma una compra, un pago ni un depósito.</label>`, "Crear ticket de solicitud")}<button class="text-button" id="back">Volver</button></div>`;
    $("#ticket").oninput = () => {
      const f = new FormData($("#ticket"));
      try {
        const amount = Math.round(Number(f.get("amount")) * 100);
        const mode = SaldoCalculator.modeForAmount(amount);
        const e = SaldoCalculator.estimate(amount, mode);
        $("#estimate").innerHTML =
          `<span class="estimate-method">${methodLabel(mode)}</span>Monto del certificado<strong>${money(e.amount)}</strong><small>Valor estimado a entregar: ${money(e.net)} · Costos estimados: ${money(e.total)}. Revisa estos importes antes de pagar. Para una cuenta en córdobas se registrará el tipo de cambio aplicado.</small>${amount > 50000 ? "<p>Plazo estimado: <b>2 a 6 días hábiles</b> desde que el administrador confirme el pago. Lunes a viernes, sin ajuste por feriados. Vigencia: 6 días hábiles desde la creación o desde la confirmación del pago, si se confirma mientras está vigente.</p>" : ""}`;
      } catch (e) {
        $("#estimate").textContent = e.message;
      }
    };
    $("#back").onclick = render;
    if (CertificateModel.presetAmounts.includes(presetAmount)) {
      $("#ticket [name=amount]").value = String(presetAmount);
      $("#ticket").oninput();
    }
    main.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
    bind("ticket", async (f) => {
      let result;
      try {
        result = await api("/api/tickets", {
          amount: f.get("amount"),
          beneficiaryName: f.get("beneficiaryName"),
          bank: f.get("bank"),
          bankAccount: f.get("bankAccount"),
          currency: f.get("currency"),
          paypalOwnership: f.get("paypalOwnership") === "on",
          consent: f.get("consent") === "on",
          conditionsAccepted: f.get("conditionsAccepted") === "on",
          conditionsVersion: CertificateModel.ticketConditionsVersion,
          requestKey,
        });
      } catch (error) {
        if (!error.message.includes("Las condiciones del ticket cambiaron"))
          throw error;
        const fresh = (await import(`./certificate.js?refresh=${Date.now()}`))
          .default;
        if (
          fresh.ticketConditionsVersion ===
          CertificateModel.ticketConditionsVersion
        )
          throw error;
        CertificateModel = fresh;
        $("#ticket .ticket-conditions ul").innerHTML = fresh.ticketConditions
          .map((condition) => `<li>${esc(condition)}</li>`)
          .join("");
        $("#ticket [name=conditionsAccepted]").checked = false;
        throw new Error(
          "Actualizamos las condiciones en este formulario. Revísalas, vuelve a marcar su aceptación y envía el ticket nuevamente.",
        );
      }
      toast("Solicitud registrada.");
      await detail(result.id);
    });
  }
  // Resizes a receipt photo in the browser so it uploads quickly (max ~900 KB).
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type))
      throw new Error("Usa una imagen JPG, PNG o WebP.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("No se pudo leer la imagen. Prueba con otra.");
    }
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82 - attempt * 0.08),
      );
      if (blob && blob.size <= 900000) return blob;
      scale *= 0.75;
    }
    throw new Error("La imagen es demasiado grande. Prueba con otra.");
  }
  let imageBase = "";
  function chatMessageHtml(message) {
    const own = me.admin
      ? message.author_role === "admin"
      : message.author_role === "customer";
    const author = own
      ? "Tú"
      : message.author_role === "admin"
        ? "Saldo Express"
        : "Cliente";
    return `<article class="chat-message ${own ? "own" : ""}" data-message-id="${esc(message.id)}"><div><strong>${author}</strong><time datetime="${new Date(message.created_at).toISOString()}">${dateTime(message.created_at)}</time></div><p>${linkifyChatText(message.body)}</p>${message.image_id ? `<a class="chat-proof" href="${imageBase}${esc(message.image_id)}" target="_blank" rel="noopener"><img src="${imageBase}${esc(message.image_id)}" alt="Comprobante de pago" loading="lazy"></a>` : ""}</article>`;
  }
  function addChatMessage(message) {
    const list = $(".chat-messages");
    if (!list || !message?.id) return;
    if (list.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`))
      return;
    list.querySelector(".chat-empty")?.remove();
    list.insertAdjacentHTML("beforeend", chatMessageHtml(message));
    const count = list.closest("section")?.querySelector(":scope > div > span");
    if (count) count.textContent = String(list.children.length);
    list.lastElementChild.scrollIntoView({ block: "nearest" });
  }
  function closeLiveChat() {
    clearTimeout(liveChatRetry);
    liveChatPath = null;
    if (liveChatSocket) {
      liveChatSocket.onclose = null;
      liveChatSocket.close();
      liveChatSocket = null;
    }
  }
  // Re-renders the open ticket without losing a comment being typed.
  async function refreshOpenTicket(id) {
    const draft = $("#ticket-message")?.value || "";
    const scroll = window.scrollY;
    await detail(id);
    const box = $("#ticket-message");
    if (box && draft) box.value = draft;
    window.scrollTo(0, scroll);
  }
  function openLiveChat(path, marker, id, delay = 1000) {
    liveChatMarker = marker;
    if (
      liveChatSocket &&
      liveChatPath === path &&
      liveChatSocket.readyState <= 1
    )
      return;
    closeLiveChat();
    if (!("WebSocket" in window)) return;
    liveChatPath = path;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`,
    );
    liveChatSocket = socket;
    socket.onopen = () => {
      delay = 1000;
    };
    socket.onmessage = (event) => {
      if (main.firstElementChild !== liveChatMarker) return closeLiveChat();
      try {
        const data = JSON.parse(event.data);
        if (data.type === "message") addChatMessage(data.message);
        else if (data.type === "refresh")
          refreshOpenTicket(id).catch(() => undefined);
      } catch {
        /* Ignore malformed events. */
      }
    };
    socket.onclose = () => {
      if (liveChatSocket !== socket) return;
      liveChatSocket = null;
      if (main.firstElementChild !== liveChatMarker) return;
      liveChatRetry = setTimeout(
        () =>
          openLiveChat(path, liveChatMarker, id, Math.min(delay * 2, 30000)),
        delay,
      );
    };
  }
  // Keeps the ticket lists current: while a list is open it listens to the
  // live room of each unfinished ticket and reloads when the status changes
  // (payment confirmed, delivery confirmed, cancelled, turn change).
  let listSockets = [];
  let listWatchMarker = null;
  let listReloadTimer;
  let listPollTimer;
  let listPollBusy = false;
  function listSignature(items, total = items.length) {
    return `${total}|${items
      .map((ticket) =>
        [ticket.id, ticket.status, ticket.version, ticket.updated_at].join(":"),
      )
      .join("|")}`;
  }
  function stopWatchingTickets() {
    clearTimeout(listReloadTimer);
    clearInterval(listPollTimer);
    listPollBusy = false;
    listSockets.forEach((socket) => {
      socket.onclose = null;
      socket.close();
    });
    listSockets = [];
    listWatchMarker = null;
  }
  function watchTickets(ids, hasChanged, livePath = null) {
    stopWatchingTickets();
    if (!ids.length && !livePath) return;
    const marker = (listWatchMarker = main.firstElementChild);
    const reload = () => {
      clearTimeout(listReloadTimer);
      listReloadTimer = setTimeout(() => {
        if (main.firstElementChild !== marker) return;
        if (document.activeElement?.closest("form")) return reload();
        const scroll = window.scrollY;
        render().then(() => window.scrollTo(0, scroll));
      }, 250);
    };
    if (hasChanged) {
      listPollTimer = setInterval(async () => {
        if (
          listPollBusy ||
          listWatchMarker !== marker ||
          document.activeElement?.closest("form")
        )
          return;
        listPollBusy = true;
        try {
          if (await hasChanged()) reload();
        } catch {
          /* WebSocket remains the primary update path. */
        } finally {
          listPollBusy = false;
        }
      }, 5000);
    }
    if (!("WebSocket" in window)) return;
    const paths = livePath
      ? [livePath]
      : ids
          .slice(0, 6)
          .map((id) => `/api/tickets/${encodeURIComponent(id)}/live`);
    paths.forEach((path) => {
      const open = (delay = 1000) => {
        if (listWatchMarker !== marker) return;
        const socket = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`,
        );
        listSockets.push(socket);
        socket.onopen = () => {
          delay = 1000;
        };
        socket.onmessage = (event) => {
          try {
            if (JSON.parse(event.data).type === "refresh") reload();
          } catch {
            /* Ignore malformed events. */
          }
        };
        socket.onclose = () => {
          listSockets = listSockets.filter((item) => item !== socket);
          if (listWatchMarker !== marker) return;
          setTimeout(() => open(Math.min(delay * 2, 30000)), delay);
        };
      };
      open();
    });
  }
  function turnWindowText(queue) {
    const seconds = queue.windowSeconds || 120;
    return seconds % 60 === 0
      ? `${seconds / 60} ${seconds === 60 ? "minuto" : "minutos"}`
      : `${seconds} segundos`;
  }
  function turnNotice(queue) {
    if (!queue) return "";
    if (me.admin)
      return `<p class="notice turn-info">Cola: posición ${queue.position} de ${queue.total}.</p>`;
    if (!queue.isTurn)
      return `<p class="notice turn-info"><strong>Turno ${queue.position} de ${queue.total}.</strong> ${queue.ahead === 1 ? "Hay 1 ticket antes que el tuyo." : `Hay ${queue.ahead} tickets antes que el tuyo.`} Cuando sea tu turno tendrás ${turnWindowText(queue)} para pagar; si no pagas a tiempo, tu ticket pasa al final de la fila. Te avisaremos aquí.</p>`;
    if (!queue.turnExpiresAt)
      return '<p class="notice turn-now"><strong>Es tu turno.</strong> Puedes pagar ahora; no hay otros tickets esperando.</p>';
    return `<div class="notice turn-now" role="timer"><strong>Es tu turno. Paga ahora.</strong><time id="turn-timer"></time><span>Tienes ${turnWindowText(queue)} para pagar. Si no, tu ticket pasa al final de la fila.</span></div>`;
  }
  async function detail(id) {
    stopWatchingTickets();
    clearInterval(turnTimer);
    clearInterval(ticketRefreshTimer);
    clearTimeout(detailExpiry);
    clearInterval(processingTimer);
    const base = me.admin ? "/api/admin/tickets/" : "/api/tickets/";
    const t = await api(base + id);
    main.className = `ticket-detail ${me.admin ? "admin-detail" : "customer-detail"}`;
    imageBase = `${base}${id}/images/`;
    const messages = t.messages || [];
    const messageList = messages.length
      ? messages.map(chatMessageHtml).join("")
      : '<p class="chat-empty">Todavía no hay comentarios en este ticket.</p>';
    const messageForm = t.canMessage
      ? `<form id="message-form" class="chat-form"><label for="ticket-message">Nuevo comentario</label><textarea id="ticket-message" name="message" required maxlength="1000" rows="3" placeholder="Escribe un comentario sobre este ticket"></textarea><div><small>Máximo 1,000 caracteres.</small><button class="button primary" type="submit">${icon("send")}Enviar</button></div><p class="form-error" role="alert"></p></form><div class="chat-proof-upload"><input type="file" id="proof-file" accept="image/jpeg,image/png,image/webp" hidden><button class="button" type="button" id="proof-button">${icon("image-up")}Adjuntar imagen</button><small>Solo imágenes (comprobantes de pago) JPG, PNG o WebP, hasta 5 por ticket. Se eliminan al vencer o cerrar el ticket.</small><p class="form-error" id="proof-error" role="alert"></p></div>`
      : '<p class="notice">La conversación está cerrada porque el ticket venció o finalizó.</p>';
    const whatsappText = ticketShareText(t, location.origin + "/");
    const whatsapp = me.admin
      ? `<section class="external-purchase"><div><h2>Aviso interno por WhatsApp</h2><p>Compartí la referencia, los montos y el plazo como aviso operativo. Los datos bancarios quedan en el panel privado. El pago y el envío se confirman únicamente desde este panel.</p></div><a class="button primary" href="https://wa.me/50586199889?text=${encodeURIComponent(whatsappText)}" target="_blank" rel="noopener">${icon("message-circle")}Enviar aviso a Saldo Express</a></section>`
      : "";
    const notification = me.admin
      ? `<p class="notice"><strong>Aviso del ticket:</strong> Correo ${t.notification?.email_delivered ? "enviado" : "pendiente"} · WhatsApp ${t.notification?.whatsapp_delivered ? "enviado" : config.whatsappEnabled ? (t.notification?.whatsapp_attempts ? "en reintento" : "en cola") : "pendiente de activación"}. El aviso no contiene el número de cuenta.</p>`
      : "";
    const adminActions = "";
    const cancelAction =
      !t.expired &&
      !t.processing_started_at &&
      (["submitted", "reviewing"].includes(t.status) ||
        (me.admin && t.status === "quoted"))
        ? '<button class="button" data-action="cancelled">Cancelar solicitud</button>'
        : "";
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Solicitudes</button><div class="heading ticket-heading"><div><p class="ticket-value-label">Monto del certificado</p><h1>${money(t.amount)}</h1><p>${methodLabel(t.mode)}</p><p class="ticket-id">${esc(t.id)}</p></div><span class="badge ${t.status}">${labels[t.status]}</span></div><div class="ticket-detail-layout"><div class="ticket-detail-primary">${turnNotice(t.queue)}<div class="ticket-deadline ${t.expired ? "expired" : ""}"><span>Vigencia del ticket</span><strong>${esc(expiryText(t))}</strong><small>${t.amount > 50000 && CertificateModel.hasExtendedInternationalValidity(t.terms_version) ? (t.processing_started_at ? "Vigencia: 6 días hábiles desde la confirmación del pago." : "Vigencia: 6 días hábiles desde la creación; se recalcula al confirmar el pago.") : "La vigencia es de 24 horas desde su creación."}</small></div>${notification}<div class="data-grid ticket-data"><div><small>Monto del certificado</small><p>${money(t.amount)}</p></div><div><small>Valor estimado a entregar</small><p>${money(t.estimate.net)}</p></div><div><small>Costos estimados</small><p>${money(t.estimate.total)}</p></div><div><small>Beneficiario</small><p>${esc(t.beneficiary_name || "Eliminado o no disponible")}</p></div><div><small>Banco y moneda</small><p>${esc(t.bank)} · ${esc(t.currency)}</p></div><div><small>Número de cuenta</small><p class="account-number">${esc(t.bank_account || "Eliminado o no disponible")}</p></div></div>${t.quote ? `<div class="notice"><strong>Importe acordado anteriormente: ${money(t.quote.received, t.currency)}</strong><p>Comisión total: ${money(t.quote.fee)}. Vigencia: ${dateTime(t.quote.expiresAt)}.</p></div>` : ""}<div class="actions">${adminActions}${cancelAction}</div>${whatsapp}</div><div class="ticket-detail-secondary"><section class="ticket-chat"><div class="section-heading"><div><h2 aria-label="Conversación del ticket">Comentarios</h2><p>Los comentarios se eliminan al vencer o cerrar el ticket. No escribas nombres, cuentas, contraseñas ni códigos.</p></div><span>${messages.length}</span></div><div class="chat-messages" aria-live="polite">${messageList}</div>${messageForm}</section><section class="ticket-history"><h2>Historial</h2><ol class="timeline">${t.events.map((e) => `<li>${esc(labels[e.action] || e.action)}<small>${dateTime(e.created_at)}</small></li>`).join("")}</ol></section></div></div>`;
    $("#back").onclick = render;
    if (t.delivery_amount) {
      const exchange =
        t.delivery_amount.currency === "NIO"
          ? ` · Equivalente en USD: ${money(t.delivery_amount.netUSD)} · Tipo de cambio aplicado: ${esc(t.delivery_amount.rate)} NIO por USD.`
          : "";
      $(".ticket-deadline").insertAdjacentHTML(
        "beforebegin",
        `<p class="notice"><strong>Importe enviado al beneficiario: ${money(t.delivery_amount.received, t.delivery_amount.currency)}</strong>${exchange}</p>`,
      );
    }
    if (t.processing_started_at)
      $(".ticket-deadline > span").textContent =
        "Vigencia de datos y conversación";
    if (t.processing_completed_at && t.status !== "cancelled")
      $(".ticket-deadline").innerHTML =
        `<span>Solicitud completada</span><strong>Enviado ${dateTime(t.processing_completed_at)}</strong><small>Los datos de destino y los comentarios ya fueron eliminados. Se conserva el historial de la solicitud.</small>`;
    const progress = document.createElement("section");
    progress.className = "order-progress";
    progress.setAttribute("aria-label", "Estado de la compra");
    const steps = [
      ["Solicitud recibida", t.created_at],
      ["Pago confirmado", t.processing_started_at],
      ["Enviado al beneficiario", t.processing_completed_at],
    ];
    progress.innerHTML = `<h2>Estado de la compra</h2><ol>${steps.map(([label, at]) => `<li class="${at ? "done" : ""}">${icon(at ? "circle-check" : "circle")}<span><strong>${label}</strong><small>${at ? dateTime(at) : "Pendiente"}</small></span></li>`).join("")}</ol>${t.processing_completed_at ? "<p>El administrador confirmó el pago y el envío al beneficiario. Tu solicitud está completada.</p>" : t.processing_started_at ? "<p>Pago confirmado. El envío al beneficiario está pendiente.</p>" : t.status === "quoted" ? "<p>Coordiná el pago en el chat del ticket; todavía no está confirmado.</p>" : t.status === "closed" ? "<p>Este ticket se cerró con el flujo anterior. No hay una confirmación registrada de pago y envío.</p>" : ""}`;
    $(".ticket-deadline").after(progress);
    if (t.certificate_code) {
      const certificateAmount = money(t.amount);
      progress.insertAdjacentHTML(
        "afterend",
        `<section class="digital-certificate" aria-labelledby="certificate-title"><img class="digital-certificate-ribbon" src="/gift-ribbon.png" alt=""><div class="digital-certificate-main"><span>CERTIFICADO DE REGALO</span><h2 id="certificate-title">Efectivo</h2><p>Monto del certificado</p><strong>${certificateAmount}</strong></div><div class="digital-certificate-stub"><span>Código</span><strong>${esc(t.certificate_code)}</strong><span>Ticket</span><small>${esc(t.id)}</small></div></section><p class="certificate-email-status">${t.certificate_email_sent_at ? `${icon("mail-check")} Enviado al correo de tu cuenta, con copia en PDF, el ${dateTime(t.certificate_email_sent_at)}.` : `${icon("clock")} El correo con tu certificado y su PDF está en cola de envío.`}</p>`,
      );
    }
    if (t.amount > 50000 && !["cancelled", "closed"].includes(t.status)) {
      const section = document.createElement("section");
      section.className = "processing-window";
      section.setAttribute("aria-label", "Seguimiento de entrega");
      $(".ticket-deadline").after(section);
      const updateProcessing = () => {
        const w = processingWindow(t);
        const status =
          w.status === "pending"
            ? "Pendiente de confirmación del pago"
            : w.status === "completed"
              ? "Entrega confirmada"
              : w.status === "overdue"
                ? "Plazo estimado cumplido: pendiente de actualización"
                : `${w.elapsed} de 6 días hábiles transcurridos`;
        section.innerHTML = `<h2>Entrega estimada · 2 a 6 días hábiles</h2><strong>${esc(status)}</strong>${w.start ? `<progress max="6" value="${w.elapsed}" aria-label="Días hábiles transcurridos"></progress><p>Pago confirmado: ${dateTime(w.start)}.</p><p>Ventana estimada: ${dateTime(w.earliest)} a ${dateTime(w.latest)}.</p>${t.processing_completed_at ? `<p>Entrega confirmada: ${dateTime(t.processing_completed_at)}.</p>` : ""}` : "<p>El contador comienza cuando el administrador confirma el pago.</p>"}<small>Lunes a viernes, hora de Nicaragua, sin ajuste por feriados. Es una estimación, no una confirmación automática de entrega. La fecha de vencimiento del ticket indica hasta cuándo están disponibles los datos de destino y los comentarios. Si vence sin entrega, el pago seguirá pendiente en el historial.</small>`;
      };
      updateProcessing();
      processingTimer = setInterval(() => {
        if (!section.isConnected) {
          clearInterval(processingTimer);
          return;
        }
        updateProcessing();
      }, 60000);
    }
    const canStart =
      !t.expired &&
      ["submitted", "reviewing", "quoted"].includes(t.status) &&
      !t.processing_started_at;
    const canComplete =
      t.processing_started_at &&
      !t.processing_completed_at &&
      t.status !== "cancelled";
    if (me.admin && (canStart || canComplete)) {
      const button = document.createElement("button");
      button.className = "button primary";
      button.id = "processing-action";
      button.innerHTML = `${icon(canStart ? "check-circle" : "package-check")}${canStart ? "Confirmar pago recibido" : "Confirmar envío al beneficiario"}`;
      $(".actions").prepend(button);
      button.onclick = () => {
        modal(
          canStart
            ? "Confirmar pago recibido"
            : "Confirmar envío al beneficiario",
          `<p>${canStart ? "Confirmá solo si verificaste el pago por su canal oficial. El cliente verá «Pago confirmado»." + (t.amount > 50000 ? " El plazo de 2 a 6 días hábiles empieza ahora." : "") : "Confirmá solo si ya realizaste y verificaste el envío al beneficiario. El ticket quedará completado, se emitirá un código único y el certificado digital se enviará al correo del cliente. Los datos de destino y comentarios se eliminarán."}</p><button class="button primary" id="confirm-processing">${canStart ? "Sí, recibí el pago" : "Sí, emitir certificado y completar"}</button><p class="form-error" id="processing-error" role="alert"></p>`,
        );
        const needsRate = !canStart && t.currency === "NIO" && !t.quote;
        if (canStart)
          $("#confirm-processing").insertAdjacentHTML(
            "beforebegin",
            `<p>Monto del certificado: <strong>${money(t.amount)}</strong> · Valor estimado a entregar: <strong>${t.quote ? money(t.quote.received, t.currency) : money(t.estimate.net)}</strong>.</p>`,
          );
        if (needsRate) {
          $("#confirm-processing").insertAdjacentHTML(
            "beforebegin",
            `<p>Valor estimado a entregar: <strong>${money(t.estimate.net)}</strong>. La comisión no cambia.</p>${field("Tipo de cambio aplicado (NIO por USD)", "exchangeRate", "number", 'id="delivery-rate" min="0.0001" max="1000" step="0.0001"')}<p id="delivery-preview" class="notice" aria-live="polite">Ingresa el tipo de cambio aplicado al envío.</p>`,
          );
          $("#delivery-rate").oninput = () => {
            try {
              const amount = deliveryAmount(t, $("#delivery-rate").value);
              $("#delivery-preview").textContent =
                "Importe enviado: " + money(amount.received, amount.currency);
            } catch (error) {
              $("#delivery-preview").textContent = error.message;
            }
          };
        }
        $("#confirm-processing").onclick = async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api(`/api/admin/tickets/${id}/processing`, {
              action: canStart ? "start" : "complete",
              version: t.version,
              ...(needsRate ? { exchangeRate: $("#delivery-rate").value } : {}),
            });
            $("#dialog").close();
            await detail(id);
          } catch (error) {
            $("#processing-error").textContent = error.message;
            $("#confirm-processing").disabled = false;
          }
        };
      };
    }
    if (t.canMessage) {
      const marker = main.firstElementChild;
      detailExpiry = setTimeout(
        () => {
          if (main.firstElementChild !== marker) return;
          // Remove the rendered destination even if the refresh has no network.
          main.innerHTML =
            '<p class="notice">El ticket venció. Sus datos de destino y comentarios ya no están disponibles.</p>';
          detail(id).catch(() =>
            toast("No se pudo actualizar el historial. Recarga la página."),
          );
        },
        Math.max(0, t.expires_at - Date.now()) + 50,
      );
    }
    document.querySelectorAll("[data-action]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await api(base + id, {
              action: b.dataset.action,
              version: t.version,
            });
            await detail(id);
          } catch (e) {
            toast(e.message);
            b.disabled = false;
          }
        }),
    );
    if ($("#message-form"))
      bind("message-form", async (f) => {
        const sent = await api(base + id + "/messages", {
          message: f.get("message"),
        });
        $("#ticket-message").value = "";
        addChatMessage(sent);
      });
    if ($("#proof-file")) {
      $("#proof-button").onclick = () => $("#proof-file").click();
      $("#proof-file").onchange = async (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        const error = $("#proof-error");
        error.textContent = "";
        if (!file) return;
        const button = $("#proof-button");
        button.disabled = true;
        try {
          const sent = await api(
            base + id + "/images",
            await shrinkImage(file),
          );
          addChatMessage(sent);
        } catch (e) {
          error.textContent = e.message;
        } finally {
          button.disabled = false;
        }
      };
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    const timer = $("#turn-timer");
    if (timer && t.queue?.turnExpiresAt) {
      const offset = t.queue.serverNow - Date.now();
      let expired = false;
      const tick = () => {
        const left = Math.max(
          0,
          Math.ceil((t.queue.turnExpiresAt - (Date.now() + offset)) / 1000),
        );
        timer.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
        if (!left && !expired) {
          expired = true;
          setTimeout(() => refreshOpenTicket(id).catch(() => undefined), 1500);
        }
      };
      tick();
      turnTimer = setInterval(tick, 1000);
    }
    if (t.canMessage)
      openLiveChat(base + id + "/live", main.firstElementChild, id);
    else closeLiveChat();
    icons();
    if (
      !me.admin &&
      !["delivered", "cancelled", "closed", "expired"].includes(t.status)
    ) {
      const marker = main.firstElementChild;
      let loading = false;
      ticketRefreshTimer = setInterval(async () => {
        if (
          loading ||
          document.visibilityState !== "visible" ||
          main.firstElementChild !== marker ||
          $("#ticket-message")?.value.trim()
        )
          return;
        loading = true;
        try {
          const latest = await api(base + id);
          if (
            main.firstElementChild === marker &&
            !$("#ticket-message")?.value.trim() &&
            (latest.version !== t.version ||
              latest.status !== t.status ||
              latest.queue?.position !== t.queue?.position ||
              latest.queue?.turnExpiresAt !== t.queue?.turnExpiresAt)
          )
            await detail(id);
        } catch {
          /* Keep the current view available during a temporary connection failure. */
        } finally {
          loading = false;
        }
      }, 30000);
    }
  }
  let accountingDate = "";
  function csvDownload(report) {
    const usd = (cents) => (cents / 100).toFixed(2);
    const rows = [
      "fecha_pago,hora_pago,ticket,metodo,cobrado_usd,paypal_estimado_usd,entrega_estimada_usd,ganancia_usd,entregado_usd,estado",
      ...report.day.tickets.map((t) =>
        [
          report.date,
          new Intl.DateTimeFormat("es-NI", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Managua",
          }).format(t.paidAt),
          t.id,
          t.mode,
          usd(t.gross),
          usd(t.paypal),
          usd(t.delivery),
          usd(t.profit),
          usd(t.net),
          t.deliveredAt ? "enviado" : "pago_confirmado",
        ].join(","),
      ),
    ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([rows.join("\n") + "\n"], { type: "text/csv" }),
    );
    link.download = `contabilidad-${report.date}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function accounting() {
    main.className = "admin-accounting";
    const r = await api(
      "/api/admin/accounting" +
        (accountingDate ? "?date=" + encodeURIComponent(accountingDate) : ""),
    );
    accountingDate = r.date;
    const clock = (value) =>
      new Intl.DateTimeFormat("es-NI", {
        timeStyle: "short",
        timeZone: "America/Managua",
      }).format(value);
    const dayLabel = (date) =>
      new Intl.DateTimeFormat("es-NI", {
        dateStyle: "full",
        timeZone: "UTC",
      }).format(new Date(date + "T12:00:00Z"));
    const day = r.day;
    const ticketRows = day.tickets.length
      ? day.tickets
          .map(
            (t) =>
              `<tr><td data-label="Hora">${clock(t.paidAt)}</td><td class="accounting-ticket-cell" data-label="Ticket"><button class="text-button accounting-ticket-link" data-ticket="${esc(t.id)}" title="Abrir ticket ${esc(t.id)}" aria-label="Abrir ticket ${esc(t.id)}">${esc(t.id)}</button></td><td data-label="Método">${t.mode === "express" ? "Express" : "Internacional"}</td><td class="num" data-label="Cobrado">${money(t.gross)}</td><td class="num" data-label="PayPal">${money(t.paypal)}</td><td class="num" data-label="Entrega">${money(t.delivery)}</td><td class="num profit" data-label="Ganancia">${money(t.profit)}</td><td data-label="Estado">${t.deliveredAt ? "Enviado" : "Pago confirmado"}</td></tr>`,
          )
          .join("")
      : "";
    main.innerHTML = `<div class="heading admin-heading"><div><h1>Contabilidad</h1><p>Ganancia por ticket y resumen del día, en hora de Nicaragua.</p></div></div>
      <form id="accounting-date" class="accounting-date"><label class="field">Día<input type="date" name="date" value="${esc(r.date)}" required></label><button class="button" type="submit">Ver día</button><button class="button" type="button" id="accounting-today">Hoy</button></form>
      <section class="accounting-summary" aria-label="Resumen del día ${esc(r.date)}">
        <article class="accounting-profit"><span>Ganancia del día</span><strong>${money(day.profit)}</strong><small>${day.count} ${day.count === 1 ? "ticket pagado" : "tickets pagados"} · ${day.delivered} ${day.delivered === 1 ? "enviado" : "enviados"}</small></article>
        <article><span>Cobrado</span><strong>${money(day.gross)}</strong><small>Total pagado por los clientes</small></article>
        <article><span>Costos estimados</span><strong>${money(day.paypal + day.delivery)}</strong><small>PayPal ${money(day.paypal)} · Entrega ${money(day.delivery)}</small></article>
        <article><span>Entregado al beneficiario</span><strong>${money(day.net)}</strong><small>Importe estimado de entrega</small></article>
      </section>
      <section class="accounting-section"><div class="accounting-title"><h2>Tickets del ${esc(dayLabel(r.date))}</h2>${day.tickets.length ? `<button class="button" type="button" id="accounting-csv">${icon("download")}Descargar CSV</button>` : ""}</div>
        ${day.tickets.length ? `<div class="table-scroll"><table class="accounting-table accounting-tickets accounting-stack"><colgroup><col class="accounting-col-time"><col class="accounting-col-ticket"><col class="accounting-col-method"><col class="accounting-col-money" span="4"><col class="accounting-col-status"></colgroup><thead><tr><th scope="col">Hora</th><th scope="col">Ticket</th><th scope="col">Método</th><th scope="col" class="num">Cobrado</th><th scope="col" class="num">PayPal</th><th scope="col" class="num">Entrega</th><th scope="col" class="num">Ganancia</th><th scope="col">Estado</th></tr></thead><tbody>${ticketRows}</tbody><tfoot><tr><th scope="row" colspan="3">Total del día</th><th class="num" data-label="Cobrado">${money(day.gross)}</th><th class="num" data-label="PayPal">${money(day.paypal)}</th><th class="num" data-label="Entrega">${money(day.delivery)}</th><th class="num profit" data-label="Ganancia">${money(day.profit)}</th><th></th></tr></tfoot></table></div>` : '<p class="empty">No hay pagos confirmados este día.</p>'}</section>
      <section class="accounting-section"><h2>Últimos 14 días</h2><div class="table-scroll"><table class="accounting-table days"><thead><tr><th>Día</th><th class="num">Tickets</th><th class="num">Cobrado</th><th class="num">Ganancia</th></tr></thead><tbody>${[
        ...r.days,
      ]
        .reverse()
        .map(
          (d) =>
            `<tr class="${d.date === r.date ? "current" : ""}"><td><button class="text-button" data-accounting-day="${esc(d.date)}">${esc(d.date)}</button></td><td class="num">${d.count}</td><td class="num">${money(d.gross)}</td><td class="num profit">${money(d.profit)}</td></tr>`,
        )
        .join("")}</tbody></table></div></section>
      <section class="accounting-section"><h2>Mes ${esc(r.month.label)}</h2><p><strong class="profit">${money(r.month.profit)}</strong> de ganancia · ${r.month.count} ${r.month.count === 1 ? "ticket pagado" : "tickets pagados"} · ${money(r.month.gross)} cobrados</p></section>
      <p class="muted accounting-note">${esc(r.note)}</p>`;
    const open = (date) => {
      accountingDate = date;
      render();
    };
    $("#accounting-date").onsubmit = (event) => {
      event.preventDefault();
      open(String(new FormData(event.currentTarget).get("date")));
    };
    $("#accounting-today").onclick = () => open("");
    document
      .querySelectorAll("[data-accounting-day]")
      .forEach(
        (button) => (button.onclick = () => open(button.dataset.accountingDay)),
      );
    if ($("#accounting-csv"))
      $("#accounting-csv").onclick = () => csvDownload(r);
    document
      .querySelectorAll("[data-ticket]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            detail(button.dataset.ticket).catch((e) => toast(e.message))),
      );
  }
  async function dashboard() {
    main.className = "admin-dashboard";
    const [users, tickets, intake] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/tickets"),
      api("/api/admin/ticket-intake"),
    ]);
    const count = (status) => users.filter((u) => u.status === status).length;
    const openTickets = tickets.filter(
      (t) =>
        !["closed", "delivered", "cancelled", "expired"].includes(t.status),
    );
    const pending = users.filter((u) => u.status === "pending");
    const needsAttention = users.filter((u) =>
      ["pending", "correction", "suspended"].includes(u.status),
    );
    const userPreview = needsAttention.length
      ? needsAttention
          .slice(0, 6)
          .map(
            (u) =>
              `<button class="admin-list-row" data-dashboard-user="${esc(u.user_id)}"><span><strong>${esc(u.email)}</strong><small>${esc(u.email)}</small></span><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></button>`,
          )
          .join("")
      : '<p class="empty compact">No hay cuentas que requieran atención.</p>';
    const ticketPreview = openTickets.length
      ? openTickets
          .slice(0, 6)
          .map(
            (t) =>
              `<button class="admin-list-row" data-dashboard-ticket="${esc(t.id)}"><span><strong>${money(t.estimate.net)}</strong><small>${esc(t.beneficiary_name || t.full_name || t.bank)} · ${esc(methodLabel(t.mode))}</small></span><span class="badge ${esc(t.status)}">${esc(labels[t.status])}</span></button>`,
          )
          .join("")
      : '<p class="empty compact">No hay solicitudes abiertas.</p>';
    main.innerHTML = `<div class="heading admin-heading"><div><h1>Resumen administrativo</h1><p>Revisa accesos y solicitudes que necesitan una decisión.</p></div><button class="button" data-dashboard-view="users">Administrar usuarios</button></div><div class="admin-metrics"><button class="metric-card" data-dashboard-view="users" data-user-filter="pending"><small>Pendientes</small><strong>${pending.length}</strong><span>Esperan aprobación manual</span></button><button class="metric-card" data-dashboard-view="users" data-user-filter="active"><small>Activas</small><strong>${count("active")}</strong><span>Pueden crear tickets</span></button><button class="metric-card" data-dashboard-view="users" data-user-filter="suspended"><small>Suspendidas</small><strong>${count("suspended")}</strong><span>No pueden crear tickets</span></button><button class="metric-card" data-dashboard-view="tickets"><small>Solicitudes abiertas</small><strong>${openTickets.length}</strong><span>Requieren seguimiento</span></button></div><div class="dashboard-grid"><section class="dashboard-section"><div class="section-heading"><div><h2>Cuentas que requieren atención</h2><p>Activación, corrección o revisión de una suspensión.</p></div><span>${needsAttention.length}</span></div><div class="admin-list">${userPreview}</div></section><section class="dashboard-section"><div class="section-heading"><div><h2>Solicitudes abiertas</h2><p>Ordenadas por su actividad más reciente.</p></div><span>${openTickets.length}</span></div><div class="admin-list">${ticketPreview}</div></section></div>`;
    $(".admin-heading").insertAdjacentHTML(
      "afterend",
      `<section class="intake-control ${intake.open ? "open" : "paused"}" aria-labelledby="intake-title"><div><span class="intake-status">${intake.open ? "Disponible" : "Pausado"}</span><h2 id="intake-title">Recepción de nuevos tickets</h2><p>${intake.open ? "Los usuarios pueden crear nuevas solicitudes." : "Se alcanzó la capacidad disponible. Los tickets existentes siguen su curso."}</p></div><button type="button" class="button ${intake.open ? "warning" : "primary"}" id="intake-toggle" role="switch" aria-checked="${intake.open}">${intake.open ? "Pausar solicitudes" : "Reabrir solicitudes"}</button></section>`,
    );
    $("#intake-toggle").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api("/api/admin/ticket-intake", {
          open: !intake.open,
        });
        config.ticketIntakeOpen = result.open;
        toast(
          result.open
            ? "La recepción de tickets está abierta."
            : "La recepción de nuevos tickets quedó pausada.",
        );
        await dashboard();
      } catch (error) {
        button.disabled = false;
        toast(error.message);
      }
    };
    document.querySelectorAll("[data-dashboard-view]").forEach(
      (button) =>
        (button.onclick = () => {
          view = button.dataset.dashboardView;
          userFilter = button.dataset.userFilter || "all";
          render();
        }),
    );
    document
      .querySelectorAll("[data-dashboard-user]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            dossier(button.dataset.dashboardUser).catch((e) =>
              toast(e.message),
            )),
      );
    document
      .querySelectorAll("[data-dashboard-ticket]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            detail(button.dataset.dashboardTicket).catch((e) =>
              toast(e.message),
            )),
      );
    const snapshot = listSignature(tickets);
    watchTickets(
      [],
      async () => listSignature(await api("/api/admin/tickets")) !== snapshot,
      "/api/admin/live",
    );
  }
  async function users() {
    main.className = "admin-users";
    const rows = await api("/api/admin/users");
    const filters = [
      ["all", "Todos"],
      ["pending", "Pendientes"],
      ["active", "Activas"],
      ["correction", "Por corregir"],
      ["suspended", "Suspendidas"],
      ["closed", "Cerradas"],
    ];
    main.innerHTML = `<div class="heading admin-heading"><div><h1>Usuarios</h1><p>La cuenta debe estar activa para crear tickets.</p></div><span>${rows.length}</span></div><div class="user-toolbar"><label class="field search-field">Buscar usuario<input id="user-search" type="search" autocomplete="off" placeholder="Nombre o correo"></label><div class="status-filters" role="group" aria-label="Filtrar por estado">${filters.map(([status, label]) => `<button type="button" data-user-status="${status}" aria-pressed="${status === userFilter}">${label}</button>`).join("")}</div></div><div id="user-list" class="admin-list"></div>`;
    const draw = () => {
      const query = $("#user-search").value.trim().toLowerCase();
      const visible = rows.filter(
        (user) =>
          (userFilter === "all" || user.status === userFilter) &&
          (!query ||
            `${user.full_name || ""} ${user.email}`
              .toLowerCase()
              .includes(query)),
      );
      $("#user-list").innerHTML =
        visible
          .map(
            (u) =>
              `<button class="admin-list-row" data-user="${esc(u.user_id)}"><span><strong>${esc(u.email)}</strong><small>${esc(u.email)}</small>${u.reason ? `<small>${esc(u.reason)}</small>` : ""}</span><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></button>`,
          )
          .join("") ||
        '<p class="empty compact">No hay usuarios con este filtro.</p>';
      document
        .querySelectorAll("[data-user]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              dossier(button.dataset.user).catch((e) => toast(e.message))),
        );
    };
    $("#user-search").oninput = draw;
    document.querySelectorAll("[data-user-status]").forEach(
      (button) =>
        (button.onclick = () => {
          userFilter = button.dataset.userStatus;
          document
            .querySelectorAll("[data-user-status]")
            .forEach((item) =>
              item.setAttribute(
                "aria-pressed",
                String(item.dataset.userStatus === userFilter),
              ),
            );
          draw();
        }),
    );
    draw();
  }
  async function dossier(id) {
    const u = await api("/api/admin/users/" + encodeURIComponent(id)),
      p = u.dossier;
    const actions =
      {
        pending: [
          ["activate", "Activar cuenta", "primary"],
          ["correct", "Pedir corrección", ""],
          ["close", "Cerrar cuenta", "danger"],
        ],
        active: [
          ["suspend", "Suspender cuenta", "warning"],
          ["close", "Cerrar cuenta", "danger"],
        ],
        suspended: [
          ["reactivate", "Reactivar cuenta", "primary"],
          ["close", "Cerrar cuenta", "danger"],
        ],
        correction: [["close", "Cerrar cuenta", "danger"]],
      }[u.status] || [];
    const actionButtons = p
      ? actions
          .map(
            ([action, label, style]) =>
              `<button class="button ${style}" data-review="${action}">${label}</button>`,
          )
          .join("")
      : "";
    const noticeHistory = (u.notices || []).length
      ? u.notices
          .map(
            (notice) =>
              `<li><span>${esc(AccountModel.labels[notice.status])}</span><small>${dateTime(notice.created_at)} · ${notice.delivered ? "Aviso enviado" : "Aviso pendiente"}</small><p>${esc(notice.reason)}</p></li>`,
          )
          .join("")
      : '<li class="empty compact">Todavía no hay decisiones registradas.</li>';
    const profileData = p
      ? `<section class="account-section"><h2>Datos para revisión</h2><dl class="account-data"><div><dt>Nombre completo</dt><dd>${esc(u.full_name || "No registrado")}</dd></div><div><dt>Teléfono de contacto</dt><dd>${esc(p.phone || "No registrado")}</dd></div><div><dt>Correo</dt><dd>${u.emailVerified ? "Verificado" : "Pendiente de verificar"}</dd></div></dl><p>La declaración no acredita titularidad. Contrasta los datos del pagador por el canal oficial antes del envío; no solicites claves ni códigos.</p><p>Plazo de revisión: hasta 2 días hábiles, de lunes a viernes, después del correo verificado y el formulario completo.</p><p class="consent-record">Condiciones: ${esc(p.version)} · ${dateTime(p.acceptedAt)}</p></section>`
      : '<p class="notice">El usuario todavía no ha aceptado las condiciones.</p>';
    main.className = "admin-account";
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Usuarios</button><div class="heading account-heading"><div><h1>${esc(u.full_name || u.email)}</h1><p>${esc(u.email)}</p></div><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></div>${u.reason ? `<p class="notice"><strong>Último motivo:</strong> ${esc(u.reason)}</p>` : ""}<div class="account-detail-grid">${profileData}<section class="account-section account-actions"><div class="section-heading"><div><h2>Acciones de cuenta</h2><p>Solo una cuenta activa puede crear tickets. Toda decisión exige un motivo y genera un aviso al correo registrado.</p></div></div>${actionButtons ? `<div class="actions">${actionButtons}</div>` : '<p class="empty compact">No hay acciones disponibles para este estado.</p>'}</section></div><section class="account-section account-history"><div class="section-heading"><div><h2>Historial de decisiones</h2><p>Estado del aviso enviado al usuario.</p></div><span>${(u.notices || []).length}</span></div><ol class="decision-history">${noticeHistory}</ol></section>`;
    $("#back").onclick = render;
    document.querySelectorAll("[data-review]").forEach(
      (button) =>
        (button.onclick = () => {
          const action = button.dataset.review;
          const guidance = {
            activate:
              "La cuenta podrá crear tickets inmediatamente después de la activación.",
            correct:
              "La cuenta seguirá sin poder crear tickets hasta enviar la corrección y ser aprobada.",
            suspend:
              "La cuenta dejará de crear tickets. El usuario podrá iniciar sesión para consultar el motivo.",
            reactivate: "La cuenta recuperará la posibilidad de crear tickets.",
            close:
              "Se retirará el acceso operativo y no podrá reactivarse desde este panel. El expediente y el historial no se borran automáticamente.",
          }[action];
          modal(
            button.textContent,
            form(
              "review",
              `<p class="decision-guidance">${esc(guidance)}</p><p class="notice">Se enviará al usuario un correo con el estado y el motivo registrado.</p><label class="field">Motivo para el usuario<textarea name="reason" required minlength="5" maxlength="300" placeholder="Explica la decisión de forma clara"></textarea></label><label class="check"><input type="checkbox" required>He revisado la cuenta y confirmo esta decisión.</label>`,
              "Confirmar y avisar",
            ),
          );
          bind("review", async (f) => {
            await api("/api/admin/users/" + encodeURIComponent(id), {
              action,
              reason: f.get("reason"),
              version: u.version,
            });
            $("#dialog").close();
            await dossier(id);
          });
        }),
    );
    icons();
  }
  refresh().catch(() => {
    main.innerHTML =
      '<div class="onboarding"><h1>No pudimos conectar</h1><p>Recarga la página en unos momentos.</p></div>';
  });
})();
