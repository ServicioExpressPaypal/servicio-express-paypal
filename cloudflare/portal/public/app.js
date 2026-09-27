import CertificateModel from "./certificate.js";

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
    quoted: "Cotizada",
    closed: "Cerrada",
    cancelled: "Cancelada",
    expired: "Vencida",
  };
  const methodLabel = (mode) =>
    mode === "express" ? "Certificado en efectivo" : "Método internacional";
  const dateTime = (value) =>
    new Intl.DateTimeFormat("es-NI", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const expiryText = (ticket) =>
    ticket.expired ? "Venció " + dateTime(ticket.expires_at) : "Vence " + dateTime(ticket.expires_at);
  let me,
    config,
    view = "dashboard",
    userFilter = "all",
    timer;
  const params = new URLSearchParams(location.search);
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
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        body instanceof FormData ? {} : { "content-type": "application/json" },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || data.message || "No se pudo completar la solicitud.",
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
      `<p>Registro cerrado. El Certificado de regalo en efectivo todavía no está disponible para compra o emisión.</p>
       <p><a href="https://saldoexpressnicaragua.com/terminos.html" target="_blank" rel="noopener">Términos y condiciones</a></p>
       <p><a href="https://saldoexpressnicaragua.com/privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a></p>
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
      : `${me.admin ? '<button class="nav" data-view="dashboard">Resumen</button><button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="users">Usuarios</button>' : '<button class="nav" data-view="tickets">Mis solicitudes</button><button class="nav" data-view="profile">Mi cuenta</button>'}<button class="icon-button" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("log-out")}</button>`;
    if ($("#logout"))
      $("#logout").onclick = async () => {
        await api("/api/auth/sign-out", {});
        me = null;
        render();
      };
    document.querySelectorAll("[data-view]").forEach(
      (b) => {
        b.classList.toggle("active", b.dataset.view === view);
        (b.onclick = () => {
          view = b.dataset.view;
          if (view === "users") userFilter = "all";
          render();
        });
      },
    );
  }
  async function render() {
    nav();
    if (!me && setupMode) return adminSetup();
    if (!me) return login();
    if (me.admin && !me.adminReady) return security();
    try {
      if (me.admin && view === "users") await users();
      else if (me.admin && view === "dashboard") await dashboard();
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
  function login(mode = "login") {
    const reset = !!resetToken;
    main.innerHTML = `<div class="onboarding">${!reset ? `<div class="auth-tabs" role="tablist"><button role="tab" data-auth="login" aria-selected="${mode === "login"}">Iniciar sesión</button><button role="tab" data-auth="signup" aria-selected="${mode === "signup"}">Crear cuenta</button></div>` : ""}<h1>${reset ? "Nueva contraseña" : mode === "signup" ? "Crea tu cuenta" : mode === "recover" ? "Recupera tu acceso" : "Bienvenido"}</h1>${mode === "signup" && !config.registrationOpen ? '<div class="notice">El registro de nuevas cuentas todavía no está abierto.</div>' : form("auth", `${!reset ? field("Correo electrónico", "email", "email", 'autocomplete="email" maxlength="254"') : ""}${mode !== "recover" ? field("Contraseña", "password", "password", `minlength="12" maxlength="128" autocomplete="${reset || mode === "signup" ? "new-password" : "current-password"}"`) : ""}`, reset ? "Guardar contraseña" : mode === "signup" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Entrar")}${!reset ? '<button class="text-button" id="recover">Olvidé mi contraseña</button>' : ""}</div>`;
    if (mode === "signup" && !reset) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent =
        "Verifica tu correo y completa tus datos. Tu cuenta quedará pendiente de aprobación manual.";
      $(".onboarding").append(note);
    }
    document
      .querySelectorAll("[data-auth]")
      .forEach((b) => (b.onclick = () => login(b.dataset.auth)));
    if ($("#recover")) $("#recover").onclick = () => login("recover");
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
  function security() {
    if (!me.twoFactorEnabled) {
      main.innerHTML = `<div class="onboarding"><h1>Protege tu acceso</h1>${form("enable", field("Confirma tu contraseña", "password", "password", 'autocomplete="current-password"'), "Configurar autenticador")}</div>`;
      bind("enable", async (f) => {
        const data = await api("/api/auth/two-factor/enable", {
          password: f.get("password"),
        });
        const key = new URL(data.totpURI).searchParams.get("secret");
        main.innerHTML = `<div class="onboarding"><h1>Vincula tu autenticador</h1><p>Clave de configuración</p><p class="mfa-secret">${esc(key)}</p><details><summary>Códigos de recuperación</summary><p class="mfa-secret">${data.backupCodes.map(esc).join("<br>")}</p></details>${form("confirm", field("Código del autenticador", "code", "text", 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"'), "Activar doble factor")}</div>`;
        bind("confirm", async (f) => {
          await api("/api/auth/two-factor/verify-totp", {
            code: f.get("code"),
          });
          await refresh();
        });
      });
      return;
    }
    main.innerHTML = `<div class="onboarding"><h1>Acceso de administrador</h1>${form("unlock", field("Código del autenticador", "code", "text", 'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"'), "Abrir panel")}</div>`;
    bind("unlock", async (f) => {
      await api("/api/admin/unlock", { code: f.get("code") });
      await refresh();
    });
  }
  function profile() {
    const p = me.profile;
    main.innerHTML = `<div class="onboarding"><h1>Mi cuenta</h1><p>${esc(me.user.email)}</p><span class="badge">${esc(AccountModel.labels[p.status])}</span>${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}${p.status === "pending" ? "<p>Recibimos tus datos. Tu cuenta se activará después de la aprobación manual.</p>" : p.status === "active" ? `<p>${esc(p.name)}</p>` : !config.kycOpen ? '<div class="notice">La recepción de datos para revisión todavía no está habilitada.</div>' : ""}</div>`;
    if (!config.kycOpen || !["incomplete", "correction"].includes(p.status))
      return;
    main.innerHTML = `<div class="onboarding"><h1>Completa tus datos</h1>${form(
      "profile",
      `<p>Datos del familiar o beneficiario en Nicaragua. La cuenta bancaria debe estar a su nombre y la activación requiere revisión manual.</p>${field("Nombre completo del familiar o beneficiario", "name", "text", 'autocomplete="name" minlength="5" maxlength="120"')}<label class="field">Banco<select name="bank" required><option value="">Selecciona</option>${CertificateModel.banks.map((b) => `<option>${esc(b)}</option>`).join("")}</select></label>${field("Número de cuenta bancaria del beneficiario", "bankAccount", "text", 'inputmode="numeric" autocomplete="off" maxlength="40"')}<label class="field">Moneda de la cuenta<select name="currency" required><option value="">Selecciona</option><option value="USD">Dólares</option><option value="NIO">Córdobas</option></select></label>${field("Teléfono del familiar o beneficiario", "phone", "tel", 'autocomplete="tel" maxlength="25"')}<p>${esc(CertificateModel.declaration)}</p>${[
        ["declaration", "Declaro que la información es verdadera."],
        ["terms", "Acepto los términos y condiciones."],
        ["privacy", "Acepto el aviso de privacidad."],
      ]
        .map(
          ([n, t]) =>
            `<label class="check"><input type="checkbox" name="${n}" required>${t}</label>`,
        )
        .join(
          "",
        )}<button type="button" class="text-button" id="legal">Términos y privacidad</button>`,
      "Enviar a revisión",
    )}</div>`;
    $("#legal").onclick = legalNotice;
    bind("profile", async (f) => {
      await api("/api/profile", {
        ...Object.fromEntries(f),
        version: CertificateModel.version,
      });
      await refresh();
    });
  }
  async function tickets() {
    const rows = await api(me.admin ? "/api/admin/tickets" : "/api/tickets");
    main.innerHTML = `<div class="heading"><h1>${me.admin ? "Solicitudes" : "Mis solicitudes"}</h1>${!me.admin ? `<button class="button primary" id="new-ticket">${icon("plus")}Nueva solicitud</button>` : ""}</div><div class="ticket-list">${rows.length ? rows.map((t) => `<button class="ticket-row" data-ticket="${t.id}"><span><strong>${money(t.estimate.net)}</strong> · ${methodLabel(t.mode)}<small>Valor estimado · Monto base ${money(t.amount)}</small><small>${esc(t.beneficiary_name || t.full_name || t.bank)} · ${new Date(t.created_at).toLocaleDateString("es-NI")}</small><small class="ticket-expiry">${esc(expiryText(t))}</small><small class="ticket-id">${esc(t.id)}</small></span><span class="badge ${t.status}">${labels[t.status]}</span></button>`).join("") : '<p class="empty">Todavía no hay solicitudes.</p>'}</div>`;
    if (!me.admin)
      $(".heading").insertAdjacentHTML(
        "afterend",
        `<p class="product-title">${esc(CertificateModel.title)}</p><p>${esc(CertificateModel.description)}</p>`,
      );
    if ($("#new-ticket")) $("#new-ticket").onclick = newTicket;
    document
      .querySelectorAll("[data-ticket]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            detail(b.dataset.ticket).catch((e) => toast(e.message))),
      );
  }
  function newTicket() {
    const requestKey = crypto.randomUUID();
    const conditions = CertificateModel.ticketConditions
      .map((condition) => `<li>${esc(condition)}</li>`)
      .join("");
    main.innerHTML = `<div class="onboarding ticket-create"><h1>${esc(CertificateModel.title)}</h1><p>${esc(CertificateModel.description)}</p><p class="notice">El ticket tendrá una vigencia de 24 horas. La compra y el pago se coordinarán fuera del portal por WhatsApp.</p>${form("ticket", `${field("Monto de la solicitud (USD)", "amount", "number", 'min="25" max="3000" step="0.01"')}<p class="field-hint">Método Express: máximo USD 500 por ticket. Los montos mayores se clasifican automáticamente como Método internacional.</p><fieldset class="ticket-destination"><legend>Datos del beneficiario</legend>${field("Nombre completo de la persona", "beneficiaryName", "text", 'autocomplete="off" minlength="5" maxlength="120"')}${field("Número de cuenta bancaria", "bankAccount", "text", 'inputmode="numeric" autocomplete="off" minlength="6" maxlength="40"')}<div class="field-pair"><label class="field">Banco<select name="bank" required><option value="">Selecciona</option>${CertificateModel.banks.map((b) => `<option>${esc(b)}</option>`).join("")}</select></label><label class="field">Moneda de la cuenta<select name="currency" required><option value="">Selecciona</option><option value="USD">Dólares</option><option value="NIO">Córdobas</option></select></label></div></fieldset><div class="estimate" id="estimate">Ingresa el monto para calcular el valor del certificado.</div><section class="ticket-conditions" aria-labelledby="ticket-conditions-title"><h2 id="ticket-conditions-title">Condiciones de la solicitud</h2><ul>${conditions}</ul></section><label class="check"><input name="conditionsAccepted" type="checkbox" required>Confirmo que soy mayor de edad, revisé los datos bancarios y acepto estas condiciones.</label><label class="check"><input name="consent" type="checkbox" required>Solicito una cotización no vinculante y entiendo que el ticket vence en 24 horas. Crear el ticket no confirma una compra, un pago ni un depósito.</label>`, "Crear ticket de solicitud")}<button class="text-button" id="back">Volver</button></div>`;
    $("#ticket").oninput = () => {
      const f = new FormData($("#ticket"));
      try {
        const amount = Math.round(Number(f.get("amount")) * 100);
        const mode = SaldoCalculator.modeForAmount(amount);
        const e = SaldoCalculator.estimate(amount, mode);
        $("#estimate").innerHTML =
          `<span class="estimate-method">${methodLabel(mode)}</span>Valor estimado del certificado<strong>${money(e.net)}</strong><small>Monto base: ${money(e.amount)} · Costos estimados: ${money(e.total)}. La cotización final está sujeta a revisión.</small>`;
      } catch (e) {
        $("#estimate").textContent = e.message;
      }
    };
    $("#back").onclick = render;
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
    const whatsapp = !me.admin && t.canMessage
      ? `<section class="external-purchase"><div><h2>Continuar por WhatsApp</h2><p>La compra y el pago se coordinan fuera de esta plataforma. El mensaje incluirá únicamente la referencia del ticket.</p></div><a class="button primary" href="https://wa.me/50586199889?text=${encodeURIComponent(`Hola, quiero continuar la compra relacionada con el ticket ${t.id}.`)}" target="_blank" rel="noopener">${icon("message-circle")}Abrir WhatsApp</a></section>`
      : "";
    const adminActions = me.admin
      ? t.status === "submitted"
        ? '<button class="button primary" data-action="reviewing">Iniciar revisión</button>'
        : t.status === "reviewing"
          ? '<button class="button primary" id="quote">Emitir cotización</button>'
          : t.status === "quoted"
            ? '<button class="button" data-action="closed">Cerrar atención</button>'
            : ""
      : "";
    const cancelAction = ["submitted", "reviewing"].includes(t.status)
      ? '<button class="button" data-action="cancelled">Cancelar solicitud</button>'
      : "";
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Solicitudes</button><div class="heading"><div><p class="ticket-value-label">Valor estimado del certificado</p><h1>${money(t.estimate.net)}</h1><p>${methodLabel(t.mode)}</p><p class="ticket-id">${esc(t.id)}</p></div><span class="badge ${t.status}">${labels[t.status]}</span></div><div class="ticket-deadline ${t.expired ? "expired" : ""}"><span>Vigencia del ticket</span><strong>${esc(expiryText(t))}</strong><small>La vigencia es de 24 horas desde su creación.</small></div><div class="data-grid ticket-data"><div><small>Monto base</small><p>${money(t.amount)}</p></div><div><small>Costos estimados</small><p>${money(t.estimate.total)}</p></div><div><small>Beneficiario</small><p>${esc(t.beneficiary_name || "No registrado")}</p></div><div><small>Banco y moneda</small><p>${esc(t.bank)} · ${esc(t.currency)}</p></div><div><small>Número de cuenta</small><p class="account-number">${esc(t.bank_account || "No registrado")}</p></div></div>${t.quote ? `<div class="notice"><strong>Cotización: ${money(t.quote.received, t.currency)}</strong><p>Comisión total: ${money(t.quote.fee)}. Vigencia: ${dateTime(t.quote.expiresAt)}.</p></div>` : ""}<div class="actions">${adminActions}${cancelAction}</div>${whatsapp}<section class="ticket-chat"><div class="section-heading"><div><h2>Conversación del ticket</h2><p>Usa este espacio para comentarios sobre la solicitud. No compartas contraseñas ni códigos.</p></div><span>${messages.length}</span></div><div class="chat-messages" aria-live="polite">${messageList}</div>${messageForm}</section><section class="ticket-history"><h2>Historial</h2><ol class="timeline">${t.events.map((e) => `<li>${esc(labels[e.action] || e.action)}<small>${dateTime(e.created_at)}</small></li>`).join("")}</ol></section>`;
    $("#back").onclick = render;
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
    if ($("#quote"))
      $("#quote").onclick = () => {
        modal(
          "Emitir cotización",
          form(
            "quote-form",
            `${field("Comisión total en USD", "fee", "number", 'min="0" step="0.01"')}${field("Importe que recibiría en " + t.currency, "received", "number", 'min="0.01" step="0.01"')}${t.currency === "NIO" ? field("Tipo de cambio", "rate", "number", 'min="0.0001" step="0.0001"') : ""}${field("Plazo de referencia (horas)", "hours", "number", 'min="1" max="168"')}<label class="field">Vigencia<select name="validity"><option value="60">1 hora</option><option value="1440">24 horas</option></select></label>`,
            "Guardar cotización",
          ),
        );
        bind("quote-form", async (f) => {
          await api(base + id, {
            action: "quote",
            version: t.version,
            quote: Object.fromEntries(f),
          });
          $("#dialog").close();
          await detail(id);
        });
      };
    icons();
  }
  async function dashboard() {
    const [users, tickets] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/tickets"),
    ]);
    const count = (status) => users.filter((u) => u.status === status).length;
    const openTickets = tickets.filter(
      (t) => !["closed", "cancelled", "expired"].includes(t.status),
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
              `<button class="admin-list-row" data-dashboard-user="${esc(u.user_id)}"><span><strong>${esc(u.full_name || "Registro sin completar")}</strong><small>${esc(u.email)}</small></span><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></button>`,
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
    document.querySelectorAll("[data-dashboard-user]").forEach(
      (button) =>
        (button.onclick = () =>
          dossier(button.dataset.dashboardUser).catch((e) => toast(e.message))),
    );
    document.querySelectorAll("[data-dashboard-ticket]").forEach(
      (button) =>
        (button.onclick = () =>
          detail(button.dataset.dashboardTicket).catch((e) => toast(e.message))),
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
            `${user.full_name || ""} ${user.email}`.toLowerCase().includes(query)),
      );
      $("#user-list").innerHTML =
        visible
          .map(
            (u) =>
              `<button class="admin-list-row" data-user="${esc(u.user_id)}"><span><strong>${esc(u.full_name || "Registro sin completar")}</strong><small>${esc(u.email)}</small>${u.reason ? `<small>${esc(u.reason)}</small>` : ""}</span><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></button>`,
          )
          .join("") || '<p class="empty compact">No hay usuarios con este filtro.</p>';
      document.querySelectorAll("[data-user]").forEach(
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
      ? `<section class="account-section"><h2>Datos revisados</h2><div class="data-grid">${p.kind === "cash-certificate" ? `<div><small>Teléfono del beneficiario</small><p>${esc(p.phone)}</p></div><div><small>Banco y moneda</small><p>${esc(p.bank)} · ${esc(p.currency)}</p></div><div><small>Cuenta bancaria del beneficiario</small><p class="account-number">${esc(p.bankAccount)}</p></div>` : `<div><small>Cédula · Archivo anterior</small><p>${esc(p.cedula)}</p></div><div><small>Origen de fondos</small><p>${esc(p.source)}</p></div>`}</div>${p.kind === "cash-certificate" ? `<p>${esc(p.declaration)}</p><p class="notice">Datos declarados por el comprador. La aprobación habilita tickets, pero no certifica la identidad ni confirma una operación.</p>` : `<p>${esc(p.detail)}</p>`}${p.hasDocuments ? `<div class="document-grid">${["front", "back"].map((side, i) => `<figure><figcaption>${i ? "Reverso" : "Frente"} · Archivo anterior</figcaption><img src="/api/admin/documents/${encodeURIComponent(id)}/${side}" alt="${i ? "Reverso" : "Frente"} de la cédula"></figure>`).join("")}</div>` : ""}<p class="consent-record">Consentimiento: ${esc(p.version)} · ${new Date(p.acceptedAt).toLocaleString("es-NI")}</p></section>`
      : '<section class="account-section"><h2>Datos revisados</h2><p class="empty compact">El usuario todavía no ha enviado información para revisión.</p></section>';
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Usuarios</button><div class="heading account-heading"><div><h1>${esc(u.full_name || "Registro sin completar")}</h1><p>${esc(u.email)}</p></div><span class="badge account-${esc(u.status)}">${esc(AccountModel.labels[u.status])}</span></div>${u.reason ? `<p class="notice"><strong>Último motivo:</strong> ${esc(u.reason)}</p>` : ""}${profileData}<section class="account-section"><div class="section-heading"><div><h2>Acciones de cuenta</h2><p>Solo una cuenta activa puede crear tickets. Toda decisión exige un motivo y genera un aviso al correo registrado.</p></div></div>${actionButtons ? `<div class="actions">${actionButtons}</div>` : '<p class="empty compact">No hay acciones disponibles para este estado.</p>'}</section><section class="account-section"><div class="section-heading"><div><h2>Historial de decisiones</h2><p>Estado del aviso enviado al usuario.</p></div><span>${(u.notices || []).length}</span></div><ol class="decision-history">${noticeHistory}</ol></section>`;
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
