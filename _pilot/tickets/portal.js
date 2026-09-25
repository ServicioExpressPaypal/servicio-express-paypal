(function () {
  "use strict";
  const M = window.TicketModel;
  const C = window.SaldoCalculator;
  const $ = (s) => document.querySelector(s);
  const main = $("#main");
  const dialog = $("#dialog");
  const escape = (v) =>
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
  const stamp = (v) =>
    new Intl.DateTimeFormat("es-NI", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Managua",
    }).format(v);
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const badge = (t) =>
    `<span class="badge ${t.status}">${M.labels[t.status]}</span>`;
  let tickets,
    notifications,
    available,
    view = "profile",
    role = "client",
    filter = "all",
    search = "",
    selectedId,
    toastTimer;
  let client = {
    name: "Cliente de ejemplo",
    email: "cliente@example.com",
    phone: "No solicitado",
  };
  const accounts = window.createAccountUI({
    main,
    showDialog,
    render,
    toast,
    escape,
    stamp,
    icon,
  });

  function seed() {
    available = { express: true, international: true };
    const now = Date.now();
    const rows = [
      [
        "SE-260923-001",
        "Ana de ejemplo",
        16400,
        "express",
        "LAFISE",
        "NIO",
        "submitted",
      ],
      [
        "SE-260923-002",
        client.name,
        10000,
        "express",
        "BAC",
        "USD",
        "submitted",
      ],
      [
        "SE-260923-003",
        "Luis de ejemplo",
        50000,
        "international",
        "Banpro",
        "USD",
        "reviewing",
      ],
      [
        "SE-260923-004",
        "Marta de ejemplo",
        20000,
        "express",
        "LAFISE",
        "NIO",
        "quoted",
      ],
      [
        "SE-260923-005",
        "Pablo de ejemplo",
        10000,
        "international",
        "BAC",
        "USD",
        "closed",
      ],
    ];
    tickets = rows.map((r, i) => {
      const t = {
        id: r[0],
        name: r[1],
        email: i === 1 ? client.email : `cliente${i + 1}@example.com`,
        phone: "Sin verificar",
        amount: r[2],
        mode: r[3],
        bank: r[4],
        currency: r[5],
        status: r[6],
        createdAt: now - (i + 1) * 17 * 60000,
        contactConsent: true,
        events: [],
        quote: null,
        invoice: null,
      };
      M.addEvent(t, "Solicitud registrada (ejemplo)", t.createdAt);
      if (["reviewing", "quoted", "closed"].includes(t.status))
        M.addEvent(t, "Revisión iniciada", t.createdAt + 60000);
      if (t.status === "quoted") {
        t.quote = {
          received: 658200,
          fee: 2000,
          rate: 36.5667,
          hours: 24,
          createdAt: now - 5 * 60000,
          expiresAt: now + 55 * 60000,
        };
        M.addEvent(t, "Cotización registrada", now - 5 * 60000);
      }
      if (t.status === "closed")
        M.addEvent(t, "Atención cerrada (ejemplo)", now - 120000);
      return t;
    });
    notifications = tickets.slice(0, 2).map((t) => ({
      id: t.id,
      at: t.createdAt,
      text: `Nueva solicitud ${t.id}. Pendiente de revisión.`,
      read: false,
    }));
  }
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      4500,
    );
  }
  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }
  function showDialog(title, html) {
    $("#dialog-title").textContent = title;
    $("#dialog-body").innerHTML = html;
    dialog.showModal();
    icons();
  }
  function current() {
    return tickets.find((t) => t.id === selectedId);
  }
  function heading(eyebrow, title, subtitle, action = "") {
    return `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
  }
  function render() {
    const account = accounts.get();
    const admin = role === "admin";
    if (!admin && !["customer", "profile"].includes(view)) view = "profile";
    if (!admin && view === "customer" && account?.status !== "active")
      view = "profile";
    document
      .querySelectorAll("[data-role]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.role === role)),
      );
    $("#session-label").textContent = admin
      ? "Administración"
      : account?.email || "Registro";
    $("#navigation").innerHTML =
      (admin
        ? [
            ["inbox", "Solicitudes", "inbox"],
            ["users", "Usuarios", "users-round"],
          ]
        : [
            ["customer", "Mis solicitudes", "inbox"],
            ["profile", "Mi cuenta", "user-round"],
          ]
      )
        .map(
          ([key, title, symbol]) =>
            `<button class="nav ${view === key || (view === "detail" && key === "inbox") ? "active" : ""}" data-view="${key}" ${!admin && key === "customer" && account?.status !== "active" ? "disabled" : ""}>${icon(symbol)}${title}${admin && key === "users" && account?.status === "pending" ? '<span class="nav-count">1</span>' : ""}</button>`,
        )
        .join("") +
      (admin
        ? `<button class="icon-button" data-view="notifications" aria-label="Notificaciones" title="Notificaciones">${icon("bell")}</button><button class="icon-button" data-view="availability" aria-label="Disponibilidad" title="Disponibilidad">${icon("settings-2")}</button>`
        : "");
    document.title =
      (admin ? "Administración" : "Mi cuenta") + " | Saldo Express";
    if (view === "profile") accounts.client();
    if (view === "users") accounts.admin();
    if (view === "inbox") renderInbox();
    if (view === "detail") renderDetail();
    if (view === "customer") renderCustomer();
    if (view === "notifications") renderNotifications();
    if (view === "availability") renderAvailability();
    icons();
  }
  function renderInbox() {
    const active = tickets.filter(
      (t) => !["closed", "cancelled"].includes(t.status),
    );
    main.innerHTML =
      heading(
        "",
        "Solicitudes",
        "",
        `<span class="muted">${active.length} abiertas</span>`,
      ) +
      `
      <div class="toolbar"><div class="tabs" aria-label="Filtrar solicitudes">${[
        ["all", "Todas"],
        ["submitted", "Nuevas"],
        ["reviewing", "En revisión"],
        ["quoted", "Cotizadas"],
        ["closed", "Cerradas"],
      ]
        .map(
          ([key, name]) =>
            `<button data-filter="${key}" class="${filter === key ? "selected" : ""}" aria-pressed="${filter === key}">${name}</button>`,
        )
        .join(
          "",
        )}</div><label class="search">${icon("search")}<input id="search" aria-label="Buscar ticket o cliente" placeholder="Buscar ticket o cliente" value="${escape(search)}"></label></div><div class="table-wrap"><table><thead><tr><th>TICKET / FECHA</th><th>CLIENTE</th><th>MONTO</th><th>MODALIDAD / DESTINO</th><th>ESTADO</th><th><span class="muted">DETALLE</span></th></tr></thead><tbody id="rows"></tbody></table></div><div id="table-count" class="table-footer"></div>`;
    renderRows();
    $("#search").addEventListener("input", (e) => {
      search = e.target.value;
      renderRows();
      icons();
    });
  }
  function renderRows() {
    const list = tickets.filter(
      (t) =>
        (filter === "all" || t.status === filter) &&
        (t.id + " " + t.name).toLowerCase().includes(search.toLowerCase()),
    );
    $("#rows").innerHTML = list.length
      ? list
          .map(
            (t) =>
              `<tr><td><button class="ticket-id" data-open="${t.id}">${t.id}</button><small>${stamp(t.createdAt)}</small></td><td>${escape(t.name)}<small>${escape(t.email)}</small></td><td class="amount">${money(t.amount)}<small>USD</small></td><td>${t.mode === "express" ? "Express" : "Internacional"}<small>${t.bank} · ${t.currency}</small></td><td>${badge(t)}</td><td><button class="icon-button" data-open="${t.id}" aria-label="Abrir ${t.id}" title="Abrir ticket">${icon("arrow-up-right")}</button></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6" class="empty">${icon("search")}<p>No hay solicitudes que coincidan.</p></td></tr>`;
    $("#table-count").textContent =
      `${list.length} solicitudes · Ejemplos para revisar el flujo`;
  }
  function datum(label, value, big = false) {
    return `<div class="datum ${big ? "big" : ""}"><span>${label}</span><strong>${escape(value)}</strong></div>`;
  }
  function estimatePanel(estimate, currency = "USD") {
    return `<section class="estimate"><h2>Estimación de la calculadora</h2><ul class="info-list">
      <li><span>Saldo declarado</span><strong>${money(estimate.amount)}</strong></li>
      <li><span>PayPal estimado</span><strong>${money(estimate.paypal)}</strong></li>
      <li><span>Procesamiento estimado</span><strong>${money(estimate.delivery)}</strong></li>
      <li><span>Comisión de Saldo Express</span><strong>${money(estimate.service)}</strong></li>
      <li><span>Costos totales estimados</span><strong>${money(estimate.total)}</strong></li>
      <li><span>Neto estimado en USD</span><strong>${money(estimate.net)}</strong></li>
    </ul><p class="muted">${currency === "NIO" ? "La entrega en córdobas queda pendiente de cotizar el tipo de cambio. " : ""}Estimación informativa; no confirma disponibilidad ni un pago. Los costos externos pueden variar.</p></section>`;
  }
  function renderDetail() {
    const t = current();
    if (!t) {
      view = "inbox";
      render();
      return;
    }
    main.innerHTML =
      `<button class="back" data-view="inbox">${icon("arrow-left")}Volver a solicitudes</button>` +
      heading(
        "SOLICITUD",
        t.id,
        `Registrada el ${stamp(t.createdAt)}`,
        badge(t),
      ) +
      `<div class="detail-layout"><div><section class="panel"><div class="section-title"><h2>Datos de la solicitud</h2><span class="muted">${t.mode === "express" ? "Express" : "Internacional"}</span></div><div class="data-grid">${datum("Monto declarado en PayPal", money(t.amount), true)}${datum("Moneda de entrega", t.currency === "USD" ? "Dólares · USD" : "Córdobas · NIO", true)}${datum("Cliente", t.name)}${datum("Correo", t.email)}${datum("Banco de destino", t.bank)}${datum("Teléfono", t.phone)}</div><div class="notice">Solicitud de cotización. No reserva fondos ni confirma un pago. Identidad y contacto aún no verificados en este piloto.</div><div class="actions">${t.status === "submitted" ? `<button class="button primary" data-action="review">${icon("clipboard-check")}Iniciar revisión</button>` : ""}${t.status === "reviewing" ? `<button class="button primary" data-action="quote">${icon("calculator")}Preparar cotización</button>` : ""}<button class="button" data-action="message">${icon("message-circle")}Preparar mensaje</button>${["submitted", "reviewing", "quoted"].includes(t.status) ? `<button class="button danger" data-action="cancel">Cancelar solicitud</button>` : ""}${t.status === "quoted" ? `<button class="button" data-action="close">Cerrar atención</button>` : ""}</div></section>${t.quote ? quotePanel(t) : ""}<section class="panel"><div class="section-title"><h2>Nota de atención</h2></div><form id="note-form"><label class="field">Nota interna<textarea name="note" required maxlength="300" placeholder="Resultado de la revisión o siguiente paso"></textarea></label><div class="form-actions"><p>Visible solo en esta vista de atención.</p><button class="button" type="submit">${icon("plus")}Guardar nota</button></div></form></section></div><aside class="detail-aside"><h3>Historial del ticket</h3><ol class="timeline">${t.events
        .slice()
        .reverse()
        .map(
          (e) => `<li>${escape(e.message)}<small>${stamp(e.at)}</small></li>`,
        )
        .join(
          "",
        )}</ol><div class="separator"></div><h3>Notificaciones</h3><p class="muted" style="margin-top:10px;font-size:12px">Aviso de nueva solicitud preparado para el panel y el correo del equipo.</p><span class="notification-channel">Correo: pendiente de conexión</span></aside></div>`;
    if (t.estimate)
      main
        .querySelector(".panel")
        .insertAdjacentHTML("afterend", estimatePanel(t.estimate, t.currency));
    $("#note-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const note = new FormData(e.target).get("note").trim();
      if (!note) return;
      M.addEvent(t, "Nota interna: " + note);
      render();
      toast("Nota guardada en la demostración.");
    });
  }
  function quotePanel(t) {
    const q = t.quote,
      expired = q.expiresAt <= Date.now();
    return `<section class="panel"><div class="section-title"><h2>Cotización orientativa</h2><span class="badge ${expired ? "cancelled" : "quoted"}">${expired ? "Vencida" : "Vigente"}</span></div><div class="quote-total"><div><small>El cliente recibiría</small><strong>${money(q.received, t.currency)}</strong></div><div><small>Comisión y costos totales</small><span class="tabular">${money(q.fee)}</span></div></div><ul class="info-list"><li><span>Tipo de cambio</span><strong>${q.rate.toFixed(4)} ${t.currency}/USD</strong></li><li><span>Válida hasta</span><strong>${stamp(q.expiresAt)}</strong></li><li><span>Plazo estimado posterior a confirmación</span><strong>${q.hours} horas</strong></li></ul><div class="actions"><button class="button" data-action="invoice" ${expired || t.status !== "quoted" ? "disabled" : ""}>${icon("file-text")}${t.invoice ? "Ver borrador de factura" : "Preparar factura de ejemplo"}</button></div><p class="muted" style="font-size:11px;margin-top:14px">El plazo todavía no ha empezado. Este piloto no confirma pagos.</p></section>`;
  }
  function quoteDialog(t) {
    showDialog(
      "Cotizar " + t.id,
      `<form id="quote-form"><div class="form-grid"><label class="field">Comisión y costos totales (USD)<input name="fee" type="number" min="0" step="0.01" required placeholder="0.00"></label><label class="field">Tipo de cambio (${t.currency}/USD)<input name="rate" type="number" min="0.0001" step="0.0001" value="${t.currency === "USD" ? "1" : ""}" ${t.currency === "USD" ? "readonly" : "required"}></label><label class="field span-2">Neto orientativo (${t.currency})<input name="received" readonly required placeholder="Completa los costos y el tipo de cambio"><small>Se calcula desde el monto solicitado: ${money(t.amount)}.</small></label><label class="field">Plazo después de confirmación (horas)<input name="hours" type="number" min="1" max="168" value="24" required></label><label class="field">Vigencia de la cotización<select name="validity"><option value="30">30 minutos</option><option value="60" selected>1 hora</option><option value="120">2 horas</option><option value="1440">24 horas</option></select></label></div><p class="form-error" id="quote-error" role="alert"></p><div class="form-actions"><p>Sin cobro ni reserva de fondos.</p><button class="button primary" type="submit">Registrar cotización</button></div></form>`,
    );
    const form = $("#quote-form");
    if (t.estimate) {
      form.elements.fee.value = (t.estimate.total / 100).toFixed(2);
      if (t.currency === "USD")
        form.elements.received.value = (t.estimate.net / 100).toFixed(2);
    }
    form.addEventListener("input", () => {
      const fee = Number(form.elements.fee.value),
        rate = Number(form.elements.rate.value);
      form.elements.received.value =
        form.elements.fee.value !== "" &&
        rate > 0 &&
        fee >= 0 &&
        fee * 100 < t.amount
          ? (((t.amount - fee * 100) * rate) / 100).toFixed(2)
          : "";
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        M.quote(t, Object.fromEntries(new FormData(form)));
        dialog.close();
        render();
        toast("Cotización de ejemplo registrada.");
      } catch (error) {
        $("#quote-error").textContent = error.message;
      }
    });
  }
  function invoiceDialog(t) {
    if (t.invoice) {
      showInvoice(t);
      return;
    }
    showDialog(
      "Borrador de factura",
      `<form id="invoice-form"><p class="muted" style="font-size:12px;margin-bottom:20px">Vista previa local. No crea una factura en PayPal ni avisa al cliente.</p><div class="form-grid"><label class="field span-2">Concepto real de la operación<textarea name="description" minlength="10" maxlength="127" required placeholder="Describe con precisión lo que se facturaría"></textarea></label>${datum("Cliente", t.name)}${datum("Total de factura", money(t.amount))}</div><p class="form-error" id="invoice-error" role="alert"></p><div class="form-actions"><p>Referencia: ${t.id}</p><button type="submit" class="button primary">Crear vista previa</button></div></form>`,
    );
    $("#invoice-form").addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        t.invoice = M.invoicePreview(
          t,
          { name: "Empresa de ejemplo", email: "comercio@example.com" },
          new FormData(e.target).get("description"),
        );
        M.addEvent(t, "Vista previa de factura preparada. Sin envío.");
        dialog.close();
        render();
        showInvoice(t);
      } catch (error) {
        $("#invoice-error").textContent = error.message;
      }
    });
  }
  function showInvoice(t) {
    const inv = t.invoice;
    showDialog(
      "Vista previa · Sin enviar",
      `<div class="invoice"><div class="invoice-head"><div><h3>Factura</h3><p class="muted">${escape(inv.invoicer.business_name)}</p></div><span class="badge reviewing">${t.id}</span></div><dl><dt>Para</dt><dd>${escape(t.name)}</dd><dt>Correo</dt><dd>${escape(t.email)}</dd><dt>Concepto</dt><dd>${escape(inv.items[0].name)}</dd></dl><div class="invoice-total"><span>Total</span><strong>${money(t.amount)}</strong></div></div><div class="notice">No existe todavía un enlace de pago. El envío por correo o la obtención del enlace requiere conectar PayPal Business con facturación habilitada.</div><div class="actions"><button id="copy-invoice" class="button">${icon("copy")}Copiar borrador JSON</button><button id="edit-invoice" class="button">${icon("pencil")}Editar concepto</button></div><details><summary>Ver datos de integración</summary><pre>${escape(JSON.stringify(inv, null, 2))}</pre></details>`,
    );
    $("#copy-invoice").onclick = () => copy(JSON.stringify(inv, null, 2));
    $("#edit-invoice").onclick = () => {
      t.invoice = null;
      dialog.close();
      invoiceDialog(t);
    };
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copiado.");
    } catch {
      toast(
        "El navegador no permitió copiar. Puedes seleccionar el texto en la vista previa.",
      );
    }
  }
  function messageDialog(t) {
    showDialog(
      "Mensaje para el cliente",
      `<label class="field">Borrador de atención<textarea id="message-text" rows="5">${escape(M.message(t))}</textarea></label><p class="muted" style="font-size:12px;margin-top:14px">No se envían mensajes desde este piloto. El teléfono del ejemplo no está verificado.</p><div class="form-actions"><span class="badge">WhatsApp · Sin conectar</span><button class="button primary" id="copy-message">${icon("copy")}Copiar mensaje</button></div>`,
    );
    $("#copy-message").onclick = () => copy($("#message-text").value);
  }
  function renderCustomer() {
    const account = accounts.get();
    window.AccountModel.requireActive(account);
    client = {
      name: account.profile.name,
      email: account.email,
      phone: "No solicitado",
    };
    const own = tickets.filter((t) => t.ownerId === account.id);
    const receptionOpen = available.express || available.international;
    main.innerHTML =
      `<div class="customer-workspace">` +
      heading("", "Nueva solicitud", "", "") +
      `${!receptionOpen ? '<p class="notice">Las solicitudes están pausadas por ahora.</p>' : ""}
        <form id="request-form"><div class="request-fields">
          <label class="field">Monto en PayPal (USD)<input name="amount" type="number" min="25" max="500" step="0.01" placeholder="100.00" aria-describedby="amount-hint" required></label>
          <label class="field">Modalidad<select name="mode"><option value="express" ${!available.express ? "disabled" : ""}>Express</option><option value="international" ${!available.international ? "disabled" : ""}>Internacional</option></select></label>
          <p class="amount-hint" id="amount-hint"></p>
          <label class="field">Banco de destino<select name="bank"><option>LAFISE</option><option>BAC</option><option>Banpro</option><option>Ficohsa</option><option>Avanz</option></select></label>
          <label class="field">Moneda de entrega<select name="currency"><option value="NIO">Córdobas</option><option value="USD">Dólares</option></select></label>
        </div><div id="estimate-preview" aria-live="polite"></div>
          <label class="check"><input type="checkbox" name="contact" required>Autorizo que me contacten por esta solicitud. La operación aún no está confirmada.</label>
        <p class="form-error" role="alert" id="request-error"></p><div class="request-actions"><button type="submit" class="button primary" ${!receptionOpen ? "disabled" : ""}>${icon("plus")}Crear solicitud</button><p>Sin pago ni reserva de fondos.</p></div></form>
      <section class="customer-history" aria-labelledby="history-title"><div class="section-title"><h2 id="history-title">Mis solicitudes</h2><span class="badge">${own.length}</span></div>
        ${own.length ? own.map((t) => `<article class="ticket-card"><div class="row"><span class="muted" style="font-family:monospace;font-size:11px">${t.id}</span>${badge(t)}</div><strong>${money(t.amount)}</strong><p>${t.mode === "express" ? "Express" : "Internacional"} · ${escape(t.bank)} · ${t.currency}</p>${t.quote ? `<p>Neto cotizado: ${money(t.quote.received, t.currency)}</p><p>Vigencia: ${stamp(t.quote.expiresAt)}${t.quote.expiresAt <= Date.now() ? " · Vencida" : ""}</p>` : !["cancelled", "closed"].includes(t.status) ? `<p>Pendiente de cotización.</p>` : ""}<small class="muted">${stamp(t.createdAt)}</small>${t.status === "submitted" ? `<div><button class="button small" data-customer-cancel="${t.id}">Cancelar solicitud</button></div>` : ""}</article>`).join("") : `<p class="empty-message">Aún no tienes solicitudes.</p>`}
      </section></div>`;
    const requestForm = $("#request-form");
    const updateEstimate = () => {
      const mode = C.siteConfig.serviceModes[requestForm.elements.mode.value];
      if (!mode) return;
      requestForm.elements.amount.min = mode.minAmount;
      requestForm.elements.amount.max = mode.maxAmount;
      $("#amount-hint").textContent =
        `De ${money(mode.minAmount * 100)} a ${money(mode.maxAmount * 100)}.`;
      const target = $("#estimate-preview");
      const costsOpen = target.querySelector("details")?.open;
      if (!requestForm.elements.amount.value) {
        target.innerHTML =
          '<div class="customer-estimate"><span>Neto estimado en USD</span><strong class="pending-estimate">Pendiente de monto</strong></div>';
        return;
      }
      try {
        const estimate = C.estimate(
          M.cents(requestForm.elements.amount.value),
          requestForm.elements.mode.value,
        );
        target.innerHTML = `<div class="customer-estimate"><span>Neto estimado en USD</span><strong>${money(estimate.net)}</strong></div>
          <p class="estimate-note">${requestForm.elements.currency.value === "NIO" ? "El total en córdobas depende del tipo de cambio al cotizar." : "Sujeto a revisión y cotización final."}</p>
          <details class="cost-details" ${costsOpen ? "open" : ""}><summary>Ver costos · ${money(estimate.total)}</summary><ul class="info-list"><li><span>PayPal</span><strong>${money(estimate.paypal)}</strong></li><li><span>Procesamiento</span><strong>${money(estimate.delivery)}</strong></li><li><span>Saldo Express</span><strong>${money(estimate.service)}</strong></li></ul></details>`;
      } catch (error) {
        target.innerHTML = `<p class="form-error">${escape(error.message)}</p>`;
      }
    };
    requestForm.addEventListener("input", (event) => {
      if (["amount", "mode", "currency"].includes(event.target.name))
        updateEstimate();
    });
    updateEstimate();
    main.querySelectorAll(".ticket-card").forEach((card, index) => {
      if (own[index].estimate)
        card.insertAdjacentHTML(
          "beforeend",
          `<p>Neto inicial estimado: <strong class="estimate-net">${money(own[index].estimate.net)}</strong></p>`,
        );
    });
    requestForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        window.AccountModel.requireActive(accounts.get());
        const amount = M.cents(data.amount);
        const estimate = C.estimate(amount, data.mode);
        if (amount < 2500 || amount > 1000000)
          throw new Error("El monto de prueba debe estar entre $25 y $10,000.");
        if (!available[data.mode])
          throw new Error("Esa modalidad está pausada. Elige otra modalidad.");
        if (data.contact !== "on")
          throw new Error("Confirma la autorización de contacto.");
        const t = {
          id: `SE-DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          name: client.name,
          ownerId: account.id,
          estimate: { ...estimate, createdAt: Date.now() },
          email: client.email,
          phone: client.phone,
          amount,
          mode: data.mode,
          bank: data.bank,
          currency: data.currency,
          status: "submitted",
          createdAt: Date.now(),
          contactConsent: true,
          events: [],
          quote: null,
          invoice: null,
        };
        M.addEvent(t, "Solicitud registrada (prueba local)");
        tickets.unshift(t);
        notifications.unshift({
          id: t.id,
          at: t.createdAt,
          text: `Nueva solicitud ${t.id}. Pendiente de revisión.`,
          read: false,
        });
        render();
        toast(`Ticket ${t.id} creado en la demostración.`);
      } catch (error) {
        $("#request-error").textContent = error.message;
      }
    });
  }
  function renderNotifications() {
    main.innerHTML =
      heading(
        "ACTIVIDAD",
        "Notificaciones",
        "Las solicitudes nuevas aparecen aquí para que ninguna quede sin revisar.",
      ) +
      `<p class="notice">Canal propuesto: panel y correo del equipo. Los avisos siguientes son ejemplos locales; no se ha enviado ningún correo.</p><section>${notifications.map((n, i) => `<article class="alert-item">${icon(n.read ? "mail-open" : "mail")}<div class="content"><p>${escape(n.text)}</p><small>${stamp(n.at)} · ${n.read ? "Leída" : "Nueva"}</small><div><span class="notification-channel">Panel · Correo pendiente de conexión</span></div></div><button class="button small" data-notification="${i}">Ver ticket ${icon("arrow-up-right")}</button></article>`).join("")}</section>`;
  }
  function renderAvailability() {
    main.innerHTML =
      heading(
        "OPERACIÓN",
        "Disponibilidad",
        "Define qué modalidades pueden recibir solicitudes nuevas.",
      ) +
      `<div class="settings">${[
        ["express", "Solicitudes Express"],
        ["international", "Solicitudes internacionales"],
      ]
        .map(
          ([key, title]) =>
            `<div class="setting-row"><div><h3>${title}</h3><p>${available[key] ? "Abiertas para revisión. Cada solicitud se cotiza individualmente." : "Pausadas. Los tickets existentes conservan su estado."}</p></div><input type="checkbox" class="switch" role="switch" data-availability="${key}" aria-label="${title}" ${available[key] ? "checked" : ""}></div>`,
        )
        .join(
          "",
        )}<div class="separator"></div><h3>Canales del piloto</h3><ul class="info-list"><li><span>Panel de tickets</span><strong>Demostración local</strong></li><li><span>Correo del equipo</span><strong>Por configurar</strong></li><li><span>WhatsApp</span><strong>Atención manual propuesta</strong></li><li><span>Facturación PayPal</span><strong>Vista previa local</strong></li><li><span>Verificación de correo y teléfono</span><strong>Por conectar</strong></li></ul></div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.role) {
      role = b.dataset.role;
      view = role === "admin" ? "users" : "profile";
      dialog.close();
      render();
      return;
    }
    if (b.dataset.view) {
      view = b.dataset.view;
      render();
      return;
    }
    if (b.dataset.filter) {
      filter = b.dataset.filter;
      render();
      return;
    }
    if (b.dataset.open) {
      selectedId = b.dataset.open;
      view = "detail";
      render();
      return;
    }
    if (b.dataset.notification !== undefined) {
      const n = notifications[Number(b.dataset.notification)];
      n.read = true;
      selectedId = n.id;
      view = "detail";
      render();
      return;
    }
    if (b.dataset.customerCancel) {
      const t = tickets.find(
        (t) =>
          t.id === b.dataset.customerCancel && t.ownerId === accounts.get()?.id,
      );
      if (t) {
        M.transition(t, "cancelled");
        render();
        toast("Solicitud de prueba cancelada.");
      }
      return;
    }
    const t = current();
    if (!t || !b.dataset.action) return;
    try {
      const account = accounts.get();
      if (
        account &&
        t.ownerId === account.id &&
        ["quote", "invoice"].includes(b.dataset.action)
      )
        window.AccountModel.requireActive(account);
      if (b.dataset.action === "review") {
        M.transition(t, "reviewing");
        render();
      }
      if (b.dataset.action === "quote") quoteDialog(t);
      if (b.dataset.action === "invoice") invoiceDialog(t);
      if (b.dataset.action === "message") messageDialog(t);
      if (["cancel", "close"].includes(b.dataset.action)) {
        const next = b.dataset.action === "cancel" ? "cancelled" : "closed";
        showDialog(
          next === "closed" ? "Cerrar atención" : "Cancelar solicitud",
          `<form id="reason-form"><label class="field">Motivo<textarea name="reason" required minlength="5" maxlength="200"></textarea></label><p class="muted" style="font-size:12px;margin-top:14px">Cerrar un ticket no equivale a confirmar un pago o un depósito.</p><div class="form-actions"><button class="button primary" type="submit">Confirmar</button></div></form>`,
        );
        $("#reason-form").onsubmit = (event) => {
          event.preventDefault();
          M.transition(t, next);
          M.addEvent(t, new FormData(event.target).get("reason"));
          dialog.close();
          render();
        };
      }
    } catch (error) {
      toast(error.message);
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset.availability) {
      available[e.target.dataset.availability] = e.target.checked;
      render();
      toast("Disponibilidad actualizada en la demostración.");
    }
  });
  $("#close-dialog").onclick = () => dialog.close();
  $("#reset").onclick = () => {
    dialog.close();
    accounts.reset();
    client = {
      name: "Cliente de ejemplo",
      email: "cliente@example.com",
      phone: "No solicitado",
    };
    seed();
    role = "client";
    view = "profile";
    filter = "all";
    search = "";
    render();
    toast("Datos de ejemplo restablecidos.");
  };
  seed();
  render();
})();
