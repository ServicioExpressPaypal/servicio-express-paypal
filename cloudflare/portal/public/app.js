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
  };
  let me,
    config,
    view = "tickets",
    timer;
  const params = new URLSearchParams(location.search);
  const resetToken = params.get("token");
  if (location.search) history.replaceState(null, "", location.pathname);
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
      : `${me.admin ? '<button class="nav" data-view="tickets">Solicitudes</button><button class="nav" data-view="users">Usuarios</button>' : '<button class="nav" data-view="tickets">Mis solicitudes</button><button class="nav" data-view="profile">Mi cuenta</button>'}<button class="icon-button" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon("log-out")}</button>`;
    if ($("#logout"))
      $("#logout").onclick = async () => {
        await api("/api/auth/sign-out", {});
        me = null;
        render();
      };
    document.querySelectorAll("[data-view]").forEach(
      (b) =>
        (b.onclick = () => {
          view = b.dataset.view;
          render();
        }),
    );
  }
  async function render() {
    nav();
    if (!me) return login();
    if (me.admin && !me.adminReady) return security();
    try {
      if (me.admin && view === "users") await users();
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
  function login(mode = "login") {
    const reset = !!resetToken;
    main.innerHTML = `<div class="onboarding">${!reset ? `<div class="auth-tabs" role="tablist"><button role="tab" data-auth="login" aria-selected="${mode === "login"}">Iniciar sesión</button><button role="tab" data-auth="signup" aria-selected="${mode === "signup"}">Crear cuenta</button></div>` : ""}<h1>${reset ? "Nueva contraseña" : mode === "signup" ? "Crea tu cuenta" : mode === "recover" ? "Recupera tu acceso" : "Bienvenido"}</h1>${mode === "signup" && !config.registrationOpen ? '<div class="notice">El registro de nuevas cuentas todavía no está abierto.</div>' : form("auth", `${!reset ? field("Correo electrónico", "email", "email", 'autocomplete="email" maxlength="254"') : ""}${mode !== "recover" ? field("Contraseña", "password", "password", `minlength="12" maxlength="128" autocomplete="${reset || mode === "signup" ? "new-password" : "current-password"}"`) : ""}`, reset ? "Guardar contraseña" : mode === "signup" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Entrar")}${!reset ? '<button class="text-button" id="recover">Olvidé mi contraseña</button>' : ""}</div>`;
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
    main.innerHTML = `<div class="onboarding"><h1>Mi cuenta</h1><p>${esc(me.user.email)}</p><span class="badge">${esc(AccountModel.labels[p.status])}</span>${p.reason ? `<p class="notice">${esc(p.reason)}</p>` : ""}${p.status === "pending" ? "<p>Recibimos tu expediente. Está pendiente de revisión.</p>" : p.status === "active" ? `<p>${esc(p.name)}</p>` : !config.kycOpen ? '<div class="notice">La recepción de documentos todavía no está habilitada.</div>' : ""}</div>`;
    if (!config.kycOpen || !["incomplete", "correction"].includes(p.status))
      return;
    main.innerHTML = `<div class="onboarding"><h1>Completa tus datos</h1>${form(
      "profile",
      `${field("Nombre completo", "name", "text", 'autocomplete="name" minlength="5" maxlength="120"')}${field("Número de cédula", "cedula", "text", 'maxlength="18" autocomplete="off"')}${["front", "back"].map((side, i) => field(i ? "Reverso de la cédula" : "Frente de la cédula", side, "file", 'accept="image/jpeg,image/png"')).join("")}<label class="field">Origen de fondos<select name="source" required><option value="">Selecciona</option>${AccountModel.sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label><label class="field">Describe el origen de los fondos<textarea name="detail" minlength="15" maxlength="600" required></textarea></label><p>${esc(AccountModel.declaration)}</p>${[
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
    $("#legal").onclick = () =>
      modal(
        "Términos y privacidad",
        [...AccountModel.terms, ...AccountModel.privacy]
          .map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`)
          .join(""),
      );
    bind("profile", async (f) => {
      await api("/api/profile", f);
      await refresh();
    });
  }
  async function tickets() {
    const rows = await api(me.admin ? "/api/admin/tickets" : "/api/tickets");
    main.innerHTML = `<div class="heading"><h1>${me.admin ? "Solicitudes" : "Mis solicitudes"}</h1>${!me.admin ? `<button class="button primary" id="new-ticket">${icon("plus")}Nueva solicitud</button>` : ""}</div><div class="ticket-list">${rows.length ? rows.map((t) => `<button class="ticket-row" data-ticket="${t.id}"><span><strong>${money(t.amount)}</strong> · ${t.mode === "express" ? "Express" : "Internacional"}<small>${esc(t.full_name || t.bank)} · ${new Date(t.created_at).toLocaleDateString("es-NI")}</small><small class="ticket-id">${esc(t.id)}</small></span><span class="badge ${t.status}">${labels[t.status]}</span></button>`).join("") : '<p class="empty">Todavía no hay solicitudes.</p>'}</div>`;
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
    main.innerHTML = `<div class="onboarding"><h1>Nueva solicitud</h1>${form("ticket", `${field("Saldo disponible en USD", "amount", "number", 'min="25" max="3000" step="0.01"')}<label class="field">Modalidad<select name="mode"><option value="express">Express · $25 a $500</option><option value="international">Internacional · Más de $500</option></select></label><label class="field">Banco<select name="bank">${["BAC", "LAFISE", "Banpro", "BDF", "Ficohsa", "Otro"].map((b) => `<option>${b}</option>`).join("")}</select></label><label class="field">Moneda de destino<select name="currency"><option value="USD">Dólares</option><option value="NIO">Córdobas</option></select></label><div class="estimate" id="estimate">Ingresa el monto.</div><label class="check"><input name="consent" type="checkbox" required>Solicito una cotización no vinculante. Crear el ticket no confirma un pago ni una operación.</label>`, "Enviar solicitud")}<button class="text-button" id="back">Volver</button></div>`;
    $("#ticket").oninput = () => {
      const f = new FormData($("#ticket"));
      try {
        const e = SaldoCalculator.estimate(
          Math.round(Number(f.get("amount")) * 100),
          f.get("mode"),
        );
        $("#estimate").innerHTML =
          `Neto estimado en USD<strong>${money(e.net)}</strong><small>Costos estimados: ${money(e.total)}. La cotización final está sujeta a revisión.</small>`;
      } catch (e) {
        $("#estimate").textContent = e.message;
      }
    };
    $("#back").onclick = render;
    bind("ticket", async (f) => {
      const result = await api("/api/tickets", {
        amount: f.get("amount"),
        mode: f.get("mode"),
        bank: f.get("bank"),
        currency: f.get("currency"),
        consent: f.get("consent") === "on",
        requestKey,
      });
      toast("Solicitud registrada.");
      await detail(result.id);
    });
  }
  async function detail(id) {
    const base = me.admin ? "/api/admin/tickets/" : "/api/tickets/";
    const t = await api(base + id);
    main.innerHTML = `<button class="back" id="back">${icon("arrow-left")}Solicitudes</button><div class="heading"><div><h1>${money(t.amount)}</h1><p class="ticket-id">${esc(t.id)}</p></div><span class="badge ${t.status}">${labels[t.status]}</span></div><div class="data-grid"><div><small>Banco de destino</small><p>${esc(t.bank)} · ${t.currency}</p></div><div><small>Neto de referencia en USD</small><p>${money(t.estimate.net)}</p></div></div>${t.quote ? `<div class="notice"><strong>Cotización: ${money(t.quote.received, t.currency)}</strong><p>Comisión total: ${money(t.quote.fee)}. Vigencia: ${new Date(t.quote.expiresAt).toLocaleString("es-NI")}.</p></div>` : ""}<div class="actions">${me.admin ? (t.status === "submitted" ? '<button class="button primary" data-action="reviewing">Iniciar revisión</button>' : t.status === "reviewing" ? '<button class="button primary" id="quote">Emitir cotización</button>' : t.status === "quoted" ? '<button class="button" data-action="closed">Cerrar atención</button>' : "") : ""}${["submitted", "reviewing"].includes(t.status) ? '<button class="button" data-action="cancelled">Cancelar solicitud</button>' : ""}</div><h2>Historial</h2><ol class="timeline">${t.events.map((e) => `<li>${esc(labels[e.action] || e.action)}<small>${new Date(e.created_at).toLocaleString("es-NI")}</small></li>`).join("")}</ol>`;
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
  async function users() {
    const rows = await api("/api/admin/users");
    main.innerHTML = `<div class="heading"><h1>Usuarios</h1><span>${rows.length}</span></div>${rows.map((u) => `<button class="ticket-row" data-user="${esc(u.user_id)}"><span>${esc(u.full_name || "Registro sin completar")}<small>${esc(u.email)}</small></span><span class="badge">${esc(AccountModel.labels[u.status])}</span></button>`).join("") || '<p class="empty">Todavía no hay usuarios registrados.</p>'}`;
    document
      .querySelectorAll("[data-user]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            dossier(b.dataset.user).catch((e) => toast(e.message))),
      );
  }
  async function dossier(id) {
    const u = await api("/api/admin/users/" + encodeURIComponent(id)),
      p = u.dossier;
    main.innerHTML = `<button class="back" id="back">Usuarios</button><div class="heading"><h1>${esc(u.full_name || "Registro sin completar")}</h1><span class="badge">${esc(AccountModel.labels[u.status])}</span></div>${
      p
        ? `<div class="data-grid"><div><small>Cédula</small><p>${esc(p.cedula)}</p></div><div><small>Origen de fondos</small><p>${esc(p.source)}</p></div></div><p>${esc(p.detail)}</p><div class="document-grid">${["front", "back"].map((side, i) => `<figure><figcaption>${i ? "Reverso" : "Frente"}</figcaption><img src="/api/admin/documents/${encodeURIComponent(id)}/${side}" alt="${i ? "Reverso" : "Frente"} de la cédula"></figure>`).join("")}</div><p>Consentimiento: ${esc(p.version)} · ${new Date(p.acceptedAt).toLocaleString("es-NI")}</p><div class="actions">${(
            {
              pending: [
                ["activate", "Activar cuenta"],
                ["correct", "Pedir corrección"],
                ["close", "Cerrar cuenta"],
              ],
              active: [
                ["suspend", "Suspender"],
                ["close", "Cerrar cuenta"],
              ],
              suspended: [
                ["reactivate", "Reactivar"],
                ["close", "Cerrar cuenta"],
              ],
              correction: [["close", "Cerrar cuenta"]],
            }[u.status] || []
          )
            .map(
              ([a, l]) =>
                `<button class="button" data-review="${a}">${l}</button>`,
            )
            .join("")}</div>`
        : "<p>El usuario no ha enviado un expediente.</p>"
    }`;
    $("#back").onclick = render;
    document.querySelectorAll("[data-review]").forEach(
      (b) =>
        (b.onclick = () => {
          modal(
            b.textContent,
            form(
              "review",
              `<label class="field">Motivo<textarea name="reason" required minlength="5" maxlength="300"></textarea></label><label class="check"><input type="checkbox" required>He revisado el expediente y confirmo esta decisión.</label>`,
              "Confirmar",
            ),
          );
          bind("review", async (f) => {
            await api("/api/admin/users/" + encodeURIComponent(id), {
              action: b.dataset.review,
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
