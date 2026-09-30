import CertificateModel from "./certificate.js";
import { toCanvas } from "./qrcode.js";
import {
  processingWindow,
  ticketShareText,
  deliveryAmount,
} from "./processing.js";

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
  let botId, botLoading, detailExpiry, processingTimer, ticketRefreshTimer;
  const botActions = {
    "/api/auth/sign-up/email": "signup",
    "/api/auth/sign-in/email": "login",
    "/api/auth/request-password-reset": "recover",
    "/api/auth/send-verification-email": "resend",
    "/api/auth/change-password": "password",
    "/api/account/delete": "delete",
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
            theme: "light",
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
            : { "content-type": "application/json" },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
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
       <p>SoftOhm Systems LLC · <a href="mailto:info@softohmsystems.com">info@softohmsystems.com</a></p>`,
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
      : `${me.admin ? '<button class="nav" data-view="dashboard">Resumen</button><button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="users">Usuarios</button>' : '<button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="history">Historial</button><button class="nav" data-view="settings">Ajustes</button>'}<button class="icon-button" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("log-out")}</button>`;
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
    clearInterval(ticketRefreshTimer);
    clearInterval(processingTimer);
    clearTimeout(detailExpiry);
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
    return `${field("Nombre completo", "fullName", "text", `autocomplete="name" minlength="5" maxlength="120" value="${esc(p.name || "")}"`)}${field("Teléfono de contacto", "phone", "tel", `autocomplete="tel" maxlength="30" placeholder="+ código de país y número" value="${esc(p.phone || "")}"`)}<label class="check"><input name="paypalOwnership" type="checkbox" required ${p.paypalOwnership ? "checked" : ""}><span>Declaro que utilizaré una cuenta de PayPal propia, a mi nombre.</span></label>`;
  }
  function login(mode = "login") {
    const reset = !!resetToken;
    main.innerHTML = `<div class="onboarding">${!reset ? `<div class="auth-tabs" role="tablist"><button role="tab" data-auth="login" aria-selected="${mode === "login"}">Iniciar sesión</button><button role="tab" data-auth="signup" aria-selected="${mode === "signup"}">Crear cuenta</button></div>` : ""}<h1>${reset ? "Nueva contraseña" : mode === "signup" ? "Crea tu cuenta" : mode === "recover" ? "Recupera tu acceso" : "Bienvenido"}</h1>${mode === "signup" && !config.registrationOpen ? '<div class="notice">El registro de nuevas cuentas todavía no está abierto.</div>' : form("auth", `${!reset ? field("Correo electrónico", "email", "email", 'autocomplete="email" maxlength="254"') : ""}${mode !== "recover" ? field("Contraseña", "password", "password", `minlength="12" maxlength="128" autocomplete="${reset || mode === "signup" ? "new-password" : "current-password"}"`) : ""}`, reset ? "Guardar contraseña" : mode === "signup" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Entrar")}${!reset ? '<button class="text-button" id="recover">Olvidé mi contraseña</button>' : ""}</div>`;
    if (mode === "signup" && !reset) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = CertificateModel.reviewNotice;
      $(".onboarding h1").after(note);
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
          await api("/api/auth/request-password-reset", {
            email: f.get("email"),
            redirectTo: location.origin + "/",
          });
          toast("Si existe la cuenta, recibirás un enlace de recuperación.");
          return;
        }
        if (mode === "signup") {
          await api("/api/auth/sign-up/email", {
            email: f.get("email"),
            password: f.get("password"),
            name: "Cliente",
            fullName: f.get("fullName"),
            phone: f.get("phone"),
            paypalOwnership: f.get("paypalOwnership") === "on",
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
        <dl class="account-data"><div><dt>Nombre completo</dt><dd>${esc(p.name || "No registrado")}</dd></div><div><dt>Teléfono de contacto</dt><dd>${esc(p.phone || "No registrado")}</dd></div><div><dt>Titularidad de PayPal</dt><dd>${p.paypalOwnership ? "Declarada por el usuario; pendiente de contrastar al pagar" : "No declarada"}</dd></div><div><dt>Correo electrónico</dt><dd>${esc(me.user.email)}</dd></div><div><dt>Verificación</dt><dd>${me.user.emailVerified ? "Correo verificado" : "Pendiente"}</dd></div><div><dt>Cuenta creada</dt><dd>${dateTime(me.user.createdAt)}</dd></div><div><dt>Estado</dt><dd>${esc(AccountModel.labels[p.status])}</dd></div>${me.consent ? `<div><dt>Aceptación de condiciones</dt><dd>${dateTime(me.consent.accepted_at)}<small>${esc(me.consent.version)}</small></dd></div>` : ""}</dl>
        ${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}${p.status === "pending" ? `<p class="notice">${esc(CertificateModel.reviewNotice)}</p>` : ""}
        <a class="text-button" href="mailto:info@softohmsystems.com">Solicitar corrección de mis datos</a>
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
        await api("/api/auth/request-password-reset", {
          email: me.user.email,
          redirectTo: location.origin + "/",
        });
        $("#dialog").close();
        toast("Revisa tu correo para restablecer la contraseña.");
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
    return `<button class="ticket-row" data-ticket="${esc(t.id)}"><span><strong>${t.delivery_amount ? money(t.delivery_amount.received, t.delivery_amount.currency) : t.quote ? money(t.quote.received, t.currency) : money(t.estimate.net)}</strong> · ${methodLabel(t.mode)}<small>${t.delivery_amount ? "Importe enviado" : t.quote ? "Importe acordado" : "Valor del ticket"} · Monto base ${money(t.amount)}</small><small>${dateTime(t.created_at)}</small><small class="ticket-id">${esc(t.id)}</small>${tracking && t.processing_started_at ? `<small>${t.processing_completed_at ? "Envío confirmado" : "Entrega en proceso"}</small>` : ""}</span><span class="badge ${esc(t.status)}">${esc(labels[t.status])}</span></button>`;
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
  }
  async function tickets() {
    const rows = me.admin
      ? await api("/api/admin/tickets")
      : (await api("/api/account/history?status=active")).items;
    main.innerHTML = `<div class="heading"><h1>${me.admin ? "Solicitudes" : "Mis solicitudes"}</h1>${!me.admin ? `<button class="button primary" id="new-ticket">${icon("plus")}Nueva solicitud</button>` : ""}</div><div class="ticket-list">${rows.length ? rows.map((t) => `<button class="ticket-row" data-ticket="${t.id}"><span><strong>${money(t.estimate.net)}</strong> · ${methodLabel(t.mode)}<small>Valor estimado · Monto base ${money(t.amount)}</small><small>${esc(t.beneficiary_name || t.full_name || t.bank)} · ${new Date(t.created_at).toLocaleDateString("es-NI")}</small><small class="ticket-expiry">${esc(expiryText(t))}</small><small class="ticket-id">${esc(t.id)}</small></span><span class="badge ${t.status}">${labels[t.status]}</span></button>`).join("") : '<p class="empty">Todavía no hay solicitudes.</p>'}</div>`;
    if (!me.admin) {
      const cards = CertificateModel.presetAmounts
        .map((amount) => {
          const estimate = SaldoCalculator.estimate(amount * 100, "express");
          return `<article class="gift-option"><div class="gift-face"><img class="gift-ribbon" src="/gift-ribbon.png" width="70" height="140" alt=""><div class="gift-title"><span>Certificado de regalo</span><h2>Efectivo</h2><small>Para alguien especial</small></div><div class="gift-stub"><span>Monto base</span><strong>$${amount}</strong><small>USD</small></div></div><div class="gift-summary"><span>Valor estimado<strong>${money(estimate.net)}</strong></span><span>Costos estimados<strong>${money(estimate.total)}</strong></span></div><button type="button" class="gift-select" data-preset="${amount}" aria-label="Elegir certificado de ${amount} dólares">Elegir $${amount} USD ${icon("arrow-right")}</button></article>`;
        })
        .join("");
      $(".heading").outerHTML =
        `<div class="heading gift-heading"><div><h1>Certificados de regalo</h1><p>Un detalle para tu familia.</p></div><button type="button" class="button" id="new-ticket">${icon("plus")}Ticket personalizado</button></div><section class="gift-catalog" aria-label="Montos disponibles"><div class="gift-grid">${cards}</div></section><h2 class="ticket-list-title">Mis solicitudes</h2>`;
      document.querySelectorAll("[data-preset]").forEach((button) => {
        button.onclick = () => newTicket(Number(button.dataset.preset));
      });
    }
    if ($("#new-ticket")) $("#new-ticket").onclick = () => newTicket();
    if (!me.admin) {
      $(".ticket-list").insertAdjacentHTML(
        "afterend",
        '<button class="text-button" id="all-history">Ver todo el historial</button>',
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
  }
  function newTicket(presetAmount) {
    const requestKey = crypto.randomUUID();
    const conditions = CertificateModel.ticketConditions
      .map((condition) => `<li>${esc(condition)}</li>`)
      .join("");
    main.innerHTML = `<div class="onboarding ticket-create"><h1>${esc(CertificateModel.title)}</h1><p>${esc(CertificateModel.description)}</p><p class="notice">Express: 24 horas de vigencia. Internacional: 6 días hábiles; si se confirma el pago durante la vigencia, se cuentan desde esa confirmación. La compra y el pago se coordinan fuera del portal por WhatsApp.</p>${form("ticket", `${field("Monto de la solicitud (USD)", "amount", "number", 'min="25" max="3000" step="0.01"')}<p class="field-hint">Método Express: máximo USD 500 por ticket. Los montos mayores se clasifican automáticamente como Método internacional.</p><fieldset class="ticket-destination"><legend>Datos del beneficiario</legend>${field("Nombre completo de la persona", "beneficiaryName", "text", 'autocomplete="off" minlength="5" maxlength="120"')}${field("Número de cuenta bancaria", "bankAccount", "text", 'inputmode="numeric" autocomplete="off" minlength="6" maxlength="40"')}<div class="field-pair"><label class="field">Banco<select name="bank" required><option value="">Selecciona</option>${CertificateModel.banks.map((b) => `<option>${esc(b)}</option>`).join("")}</select></label><label class="field">Moneda de la cuenta<select name="currency" required><option value="">Selecciona</option><option value="USD">Dólares</option><option value="NIO">Córdobas</option></select></label></div></fieldset><div class="estimate" id="estimate">Ingresa el monto para calcular el valor del certificado.</div><section class="ticket-conditions" aria-labelledby="ticket-conditions-title"><h2 id="ticket-conditions-title">Condiciones de la solicitud</h2><ul>${conditions}</ul></section><label class="check"><input name="conditionsAccepted" type="checkbox" required>Confirmo que soy mayor de edad, revisé los datos bancarios y acepto estas condiciones.</label><label class="check"><input name="consent" type="checkbox" required>Solicito atención mediante este ticket y acepto su vigencia según la modalidad y las condiciones de compra y reembolsos. Crear el ticket no confirma una compra, un pago ni un depósito.</label>`, "Crear ticket de solicitud")}<button class="text-button" id="back">Volver</button></div>`;
    $("#ticket").oninput = () => {
      const f = new FormData($("#ticket"));
      try {
        const amount = Math.round(Number(f.get("amount")) * 100);
        const mode = SaldoCalculator.modeForAmount(amount);
        const e = SaldoCalculator.estimate(amount, mode);
        $("#estimate").innerHTML =
          `<span class="estimate-method">${methodLabel(mode)}</span>Valor estimado del certificado<strong>${money(e.net)}</strong><small>Monto base: ${money(e.amount)} · Costos estimados: ${money(e.total)}. Revisa estos importes antes de pagar. Para una cuenta en córdobas se registrará el tipo de cambio aplicado.</small>${amount > 50000 ? "<p>Plazo estimado: <b>2 a 6 días hábiles</b> desde que el administrador confirme el pago. Lunes a viernes, sin ajuste por feriados. Vigencia: 6 días hábiles desde la creación o desde la confirmación del pago, si se confirma mientras está vigente.</p>" : ""}`;
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
      const result = await api("/api/tickets", {
        amount: f.get("amount"),
        beneficiaryName: f.get("beneficiaryName"),
        bank: f.get("bank"),
        bankAccount: f.get("bankAccount"),
        currency: f.get("currency"),
        consent: f.get("consent") === "on",
        conditionsAccepted: f.get("conditionsAccepted") === "on",
        conditionsVersion: CertificateModel.ticketConditionsVersion,
        requestKey,
      });
      toast("Solicitud registrada.");
      await detail(result.id);
    });
  }
  async function detail(id) {
    clearInterval(ticketRefreshTimer);
    clearTimeout(detailExpiry);
    clearInterval(processingTimer);
    const base = me.admin ? "/api/admin/tickets/" : "/api/tickets/";
    const t = await api(base + id);
    const messages = t.messages || [];
    const messageList = messages.length
      ? messages
          .map((message) => {
            const own = me.admin
              ? message.author_role === "admin"
              : message.author_role === "customer";
            const author = own
              ? "Tú"
              : message.author_role === "admin"
                ? "Saldo Express"
                : "Cliente";
            return `<article class="chat-message ${own ? "own" : ""}"><div><strong>${author}</strong><time datetime="${new Date(message.created_at).toISOString()}">${dateTime(message.created_at)}</time></div><p>${esc(message.body)}</p></article>`;
          })
          .join("")
      : '<p class="chat-empty">Todavía no hay comentarios en este ticket.</p>';
    const messageForm = t.canMessage
      ? `<form id="message-form" class="chat-form"><label for="ticket-message">Nuevo comentario</label><textarea id="ticket-message" name="message" required maxlength="1000" rows="3" placeholder="Escribe un comentario sobre este ticket"></textarea><div><small>Máximo 1,000 caracteres.</small><button class="button primary" type="submit">${icon("send")}Enviar</button></div><p class="form-error" role="alert"></p></form>`
      : '<p class="notice">La conversación está cerrada porque el ticket venció o finalizó.</p>';
    const whatsappText = ticketShareText(t, location.origin + "/");
    const whatsapp =
      me.admin || t.canMessage
        ? `<section class="external-purchase"><div><h2>${me.admin ? "Resumen por WhatsApp" : "Continuar por WhatsApp"}</h2><p>${me.admin ? "Compartí referencia, montos y plazo. Los datos bancarios quedan en el panel privado. El envío requiere confirmación en WhatsApp." : "Tu ticket está registrado. Continuá por WhatsApp para coordinar la atención."}</p></div><a class="button primary" href="https://wa.me/50586199889?text=${encodeURIComponent(whatsappText)}" target="_blank" rel="noopener">${icon("message-circle")}${me.admin ? "Enviar resumen a Saldo Express" : "Abrir WhatsApp"}</a></section>`
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
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Solicitudes</button><div class="heading"><div><p class="ticket-value-label">Valor estimado del certificado</p><h1>${money(t.estimate.net)}</h1><p>${methodLabel(t.mode)}</p><p class="ticket-id">${esc(t.id)}</p></div><span class="badge ${t.status}">${labels[t.status]}</span></div><div class="ticket-deadline ${t.expired ? "expired" : ""}"><span>Vigencia del ticket</span><strong>${esc(expiryText(t))}</strong><small>${t.amount > 50000 && t.terms_version === CertificateModel.ticketConditionsVersion ? (t.processing_started_at ? "Vigencia: 6 días hábiles desde la confirmación del pago." : "Vigencia: 6 días hábiles desde la creación; se recalcula al confirmar el pago.") : "La vigencia es de 24 horas desde su creación."}</small></div>${notification}<div class="data-grid ticket-data"><div><small>Monto base</small><p>${money(t.amount)}</p></div><div><small>Costos estimados</small><p>${money(t.estimate.total)}</p></div><div><small>Beneficiario</small><p>${esc(t.beneficiary_name || "Eliminado o no disponible")}</p></div><div><small>Banco y moneda</small><p>${esc(t.bank)} · ${esc(t.currency)}</p></div><div><small>Número de cuenta</small><p class="account-number">${esc(t.bank_account || "Eliminado o no disponible")}</p></div></div>${t.quote ? `<div class="notice"><strong>Importe acordado anteriormente: ${money(t.quote.received, t.currency)}</strong><p>Comisión total: ${money(t.quote.fee)}. Vigencia: ${dateTime(t.quote.expiresAt)}.</p></div>` : ""}<div class="actions">${adminActions}${cancelAction}</div>${whatsapp}<section class="ticket-chat"><div class="section-heading"><div><h2>Conversación del ticket</h2><p>Los comentarios se eliminan al vencer o cerrar el ticket. No escribas nombres, cuentas, contraseñas ni códigos.</p></div><span>${messages.length}</span></div><div class="chat-messages" aria-live="polite">${messageList}</div>${messageForm}</section><section class="ticket-history"><h2>Historial</h2><ol class="timeline">${t.events.map((e) => `<li>${esc(labels[e.action] || e.action)}<small>${dateTime(e.created_at)}</small></li>`).join("")}</ol></section>`;
    $("#back").onclick = render;
    if (t.quote) {
      $(".ticket-value-label").textContent = "Valor acordado anteriormente";
      $(".heading h1").textContent = money(t.quote.received, t.currency);
    }
    if (t.delivery_amount) {
      $(".ticket-value-label").textContent = "Importe enviado al beneficiario";
      $(".heading h1").textContent = money(
        t.delivery_amount.received,
        t.delivery_amount.currency,
      );
      if (t.delivery_amount.currency === "NIO")
        $(".ticket-deadline").insertAdjacentHTML(
          "beforebegin",
          `<p class="notice">Valor del ticket: ${money(t.delivery_amount.netUSD)} · Tipo de cambio aplicado: ${esc(t.delivery_amount.rate)} NIO por USD.</p>`,
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
    progress.innerHTML = `<h2>Estado de la compra</h2><ol>${steps.map(([label, at]) => `<li class="${at ? "done" : ""}">${icon(at ? "circle-check" : "circle")}<span><strong>${label}</strong><small>${at ? dateTime(at) : "Pendiente"}</small></span></li>`).join("")}</ol>${t.processing_completed_at ? "<p>El administrador confirmó el pago y el envío al beneficiario. Tu solicitud está completada.</p>" : t.processing_started_at ? "<p>Pago confirmado. El envío al beneficiario está pendiente.</p>" : t.status === "quoted" ? "<p>Coordiná el pago por WhatsApp; todavía no está confirmado.</p>" : t.status === "closed" ? "<p>Este ticket se cerró con el flujo anterior. No hay una confirmación registrada de pago y envío.</p>" : ""}`;
    $(".ticket-deadline").after(progress);
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
          `<p>${canStart ? "Confirmá solo si verificaste el pago por su canal oficial. El cliente verá «Pago confirmado»." + (t.amount > 50000 ? " El plazo de 2 a 6 días hábiles empieza ahora." : "") : "Confirmá solo si ya realizaste y verificaste el envío al beneficiario. El ticket quedará completado y el cliente verá «Enviado al beneficiario». Los datos de destino y comentarios se eliminarán."}</p><button class="button primary" id="confirm-processing">${canStart ? "Sí, recibí el pago" : "Sí, confirmé el envío"}</button><p class="form-error" id="processing-error" role="alert"></p>`,
        );
        const needsRate = !canStart && t.currency === "NIO" && !t.quote;
        if (canStart)
          $("#confirm-processing").insertAdjacentHTML(
            "beforebegin",
            `<p>Monto base: <strong>${money(t.amount)}</strong> · Valor del ticket: <strong>${t.quote ? money(t.quote.received, t.currency) : money(t.estimate.net)}</strong>.</p>`,
          );
        if (needsRate) {
          $("#confirm-processing").insertAdjacentHTML(
            "beforebegin",
            `<p>Valor del ticket: <strong>${money(t.estimate.net)}</strong>. La comisión no cambia.</p>${field("Tipo de cambio aplicado (NIO por USD)", "exchangeRate", "number", 'id="delivery-rate" min="0.0001" max="1000" step="0.0001"')}<p id="delivery-preview" class="notice" aria-live="polite">Ingresa el tipo de cambio aplicado al envío.</p>`,
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
        await api(base + id + "/messages", { message: f.get("message") });
        await detail(id);
      });
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
            (latest.version !== t.version || latest.status !== t.status)
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
  async function dashboard() {
    const [users, tickets] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/tickets"),
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
  }
  async function users() {
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
      ? `<section class="account-section"><h2>Datos para revisión</h2><dl class="account-data"><div><dt>Nombre completo</dt><dd>${esc(u.full_name || "No registrado")}</dd></div><div><dt>Teléfono de contacto</dt><dd>${esc(p.phone || "No registrado")}</dd></div><div><dt>Correo</dt><dd>${u.emailVerified ? "Verificado" : "Pendiente de verificar"}</dd></div><div><dt>Titularidad de PayPal</dt><dd>${p.paypalOwnership ? "El usuario declara que la cuenta está a su nombre" : "No declarada"}</dd></div></dl><p>La declaración no acredita titularidad. Contrasta los datos del pagador por el canal oficial antes del envío; no solicites claves ni códigos.</p><p>Plazo de revisión: hasta 2 días hábiles, de lunes a viernes, después del correo verificado y el formulario completo.</p><p class="consent-record">Condiciones: ${esc(p.version)} · ${dateTime(p.acceptedAt)}</p></section>`
      : '<p class="notice">El usuario todavía no ha aceptado las condiciones.</p>';
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Usuarios</button><div class="heading account-heading"><div><h1>${esc(u.full_name || u.email)}</h1><p>${esc(u.email)}</p></div><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></div>${u.reason ? `<p class="notice"><strong>Último motivo:</strong> ${esc(u.reason)}</p>` : ""}${profileData}<section class="account-section"><div class="section-heading"><div><h2>Acciones de cuenta</h2><p>Solo una cuenta activa puede crear tickets. Toda decisión exige un motivo y genera un aviso al correo registrado.</p></div></div>${actionButtons ? `<div class="actions">${actionButtons}</div>` : '<p class="empty compact">No hay acciones disponibles para este estado.</p>'}</section><section class="account-section"><div class="section-heading"><div><h2>Historial de decisiones</h2><p>Estado del aviso enviado al usuario.</p></div><span>${(u.notices || []).length}</span></div><ol class="decision-history">${noticeHistory}</ol></section>`;
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
