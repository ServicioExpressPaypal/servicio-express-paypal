(function () {
  "use strict";
  window.createAccountUI = function ({
    main,
    showDialog,
    render,
    toast,
    escape: esc,
    stamp,
    icon,
  }) {
    const A = window.AccountModel;
    let account = null,
      dossier = false;
    const urls = new Set();
    const $ = (s) => document.querySelector(s);
    const status = () =>
      `<span class="badge account-${account.status}">${A.labels[account.status]}</span>`;
    function release() {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    }
    function photo(file) {
      const url = URL.createObjectURL(file);
      urls.add(url);
      return url;
    }
    function legal(kind) {
      showDialog(
        kind === "terms" ? "Términos y condiciones" : "Privacidad",
        `<div class="legal"><span class="badge">Borrador · ${A.version}</span>${A[kind].map(([title, text]) => `<h3>${title}</h3><p>${esc(text)}</p>`).join("")}</div>`,
      );
    }
    function steps() {
      const index =
        !account || account.status === "unverified"
          ? 0
          : ["incomplete", "correction"].includes(account.status)
            ? 1
            : 2;
      return `<ol class="steps" aria-label="Activación de cuenta">${["Correo", "Tus datos", "Revisión"].map((name, i) => `<li ${index === i ? 'aria-current="step"' : ""} class="${i <= index ? "reached" : ""}"><span>${i < index ? icon("check") : i + 1}</span>${name}</li>`).join("")}</ol>`;
    }
    function client() {
      release();
      if (!account) {
        main.innerHTML = `<div class="onboarding">${steps()}
          <h1>Crea tu cuenta</h1><p class="intro">Empieza con tu correo electrónico.</p>
          <form id="signup" class="stack">
            <label class="field">Correo electrónico<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="tu@correo.com" required></label>
            <div class="field"><label for="password">Contraseña</label><div class="password-field">
              <input id="password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required aria-describedby="password-help">
              <button type="button" class="icon-button" id="show-password" aria-label="Mostrar contraseña" title="Mostrar contraseña">${icon("eye")}</button>
            </div><small id="password-help">Mínimo 12 caracteres. En esta demo, usa una contraseña ficticia.</small></div>
            <p class="form-error" role="alert" id="account-error"></p>
            <button class="button primary" type="submit">Crear cuenta ${icon("arrow-right")}</button>
          </form><p class="onboarding-footer">Activación sujeta a revisión de identidad.</p></div>`;
        $("#show-password").onclick = (e) => {
          const input = $("#password"),
            show = input.type === "password";
          input.type = show ? "text" : "password";
          e.currentTarget.setAttribute(
            "aria-label",
            show ? "Ocultar contraseña" : "Mostrar contraseña",
          );
          e.currentTarget.title = show
            ? "Ocultar contraseña"
            : "Mostrar contraseña";
        };
        $("#signup").onsubmit = (e) => {
          e.preventDefault();
          try {
            account = A.register(
              e.target.elements.email.value,
              e.target.elements.password.value,
            );
            e.target.reset();
            render();
          } catch (err) {
            $("#account-error").textContent = err.message;
          }
        };
        return;
      }
      if (account.status === "unverified") {
        main.innerHTML = `<div class="onboarding">${steps()}<div class="state-symbol">${icon("mail-check")}</div><h1>Verifica tu correo</h1><p class="intro account-email">${esc(account.email)}</p><p>La verificación del correo es el primer paso para completar tu registro.</p><div class="notice">En esta demo no se envía un correo. La comprobación se simula con el botón siguiente.</div><button class="button primary full" id="verify">Simular correo verificado ${icon("arrow-right")}</button></div>`;
        $("#verify").onclick = () => {
          A.verify(account);
          render();
        };
        return;
      }
      if (["incomplete", "correction"].includes(account.status)) {
        kyc();
        return;
      }
      const p = account.profile;
      if (account.status === "active") {
        main.innerHTML = `<div class="narrow"><div class="heading"><h1>Mi cuenta</h1>${status()}</div><div class="data-grid">${datum("Nombre completo", p.name)}${datum("Correo verificado", account.email)}${datum("Cédula", masked(p.cedula))}${datum("Origen de fondos", p.source)}</div><div class="separator"></div><p class="muted">Tu cuenta fue activada después de la revisión manual.</p><div class="actions"><button class="button primary" data-view="customer">${icon("plus")}Nueva solicitud</button><button class="text-button" data-legal="terms">Términos aceptados</button><button class="text-button" data-legal="privacy">Privacidad</button></div></div>`;
        return;
      }
      const pending = account.status === "pending";
      main.innerHTML = `<div class="onboarding">${pending ? steps() : ""}<div class="state-symbol">${icon(pending ? "clock-3" : "lock-keyhole")}</div>${status()}<h1>${pending ? "Recibimos tus datos" : account.status === "suspended" ? "Tu cuenta está suspendida" : "Tu cuenta está cerrada"}</h1><p class="intro">${pending ? "Revisaremos tu información antes de activar la cuenta. Por ahora no puedes crear solicitudes." : "No puedes crear solicitudes nuevas."}</p>${!pending ? `<div class="notice"><strong>Motivo</strong><p>${esc(account.reason)}</p></div><p class="muted">Canal de revisión y atención: pendiente de configurar antes del lanzamiento.</p>` : `<div class="receipt">${datum("Titular", p.name)}${datum("Expediente", account.id)}${datum("Enviado", stamp(p.acceptedAt))}</div>`}<div class="actions"><button class="text-button" data-legal="terms">Términos y condiciones</button><button class="text-button" data-legal="privacy">Privacidad</button></div></div>`;
    }
    function datum(label, value) {
      return `<div class="datum"><span>${label}</span><strong>${esc(value)}</strong></div>`;
    }
    function masked(value) {
      return "••••••••••" + value.slice(-4);
    }
    function kyc() {
      const p = account.profile || {};
      main.innerHTML = `<div class="onboarding kyc">${steps()}<h1>Completa tus datos</h1><p class="intro">Usa el nombre que aparece en tu cédula nicaragüense.</p>${account.status === "correction" ? `<div class="notice"><strong>Corrección solicitada</strong><p>${esc(account.reason)}</p><p>Vuelve a adjuntar ambas caras de la cédula.</p></div>` : ""}<form id="kyc" class="stack"><div class="form-grid"><label class="field span-2">Nombre completo<input name="name" autocomplete="name" required minlength="5" maxlength="120" value="${esc(p.name || "")}"></label><label class="field span-2">Número de cédula<input name="cedula" required maxlength="18" autocomplete="off" spellcheck="false" placeholder="000-000000-0000A" value="${esc(p.cedula || "")}"></label>${["front", "back"].map((side, i) => `<label class="field">${i ? "Reverso" : "Frente"} de la cédula<div class="upload"><span>${icon("image-plus")} JPG o PNG · Hasta 5 MB</span><input name="${side}" type="file" accept="image/jpeg,image/png" required aria-label="${i ? "Reverso" : "Frente"} de la cédula"><img id="preview-${side}" hidden alt="Vista previa del ${i ? "reverso" : "frente"}"></div></label>`).join("")}<label class="field span-2">Origen de los fondos<select name="source" required><option value="">Selecciona una opción</option>${A.sources.map((s) => `<option ${p.source === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="field span-2">Describe el origen de los fondos<textarea name="detail" minlength="15" maxlength="600" required placeholder="Actividad, empleador o negocio del que provienen los fondos">${esc(p.detail || "")}</textarea></label></div><div class="declaration"><h2>Declaración de origen de fondos</h2><p>${esc(A.declaration)}</p><label class="check"><input name="declaration" type="checkbox" required>Declaro que lo anterior es cierto.</label></div><div class="consents"><label class="check"><input name="terms" type="checkbox" required><span>Acepto los <button type="button" class="text-button" data-legal="terms">términos y condiciones</button>, incluida la política de suspensión y cierre.</span></label><label class="check"><input name="privacy" type="checkbox" required><span>Autorizo el tratamiento de mis datos para esta revisión conforme al <button type="button" class="text-button" data-legal="privacy">aviso de privacidad</button>.</span></label></div><p class="form-error" id="account-error" role="alert"></p><button class="button primary" type="submit">Enviar a revisión ${icon("arrow-right")}</button></form></div>`;
      const form = $("#kyc");
      form.addEventListener("change", async (e) => {
        if (e.target.type !== "file") return;
        const input = e.target,
          preview = $("#preview-" + input.name);
        preview.hidden = true;
        if (preview.dataset.url) {
          URL.revokeObjectURL(preview.dataset.url);
          urls.delete(preview.dataset.url);
        }
        input.setCustomValidity("");
        const file = input.files[0];
        if (!file) return;
        try {
          A.checkPhoto(file);
          const bitmap = await createImageBitmap(file);
          bitmap.close();
          if (input.files[0] !== file) return;
          preview.src = photo(file);
          preview.dataset.url = preview.src;
          preview.hidden = false;
          $("#account-error").textContent = "";
        } catch (err) {
          input.setCustomValidity(
            "Elige una imagen JPG o PNG válida de hasta 5 MB.",
          );
          $("#account-error").textContent = input.validationMessage;
        }
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
          const data = Object.fromEntries(new FormData(form));
          for (const side of ["front", "back"]) {
            A.checkPhoto(data[side]);
            const bitmap = await createImageBitmap(data[side]);
            bitmap.close();
          }
          A.submit(account, data);
          release();
          render();
          toast("Expediente de ejemplo enviado a revisión.");
        } catch (err) {
          $("#account-error").textContent =
            err instanceof DOMException
              ? "No se pudo leer una imagen. Usa JPG o PNG."
              : err.message;
          button.disabled = false;
        }
      };
    }
    function admin() {
      release();
      if (dossier && account?.profile) {
        review();
        return;
      }
      main.innerHTML = `<div class="heading"><h1>Usuarios</h1><span class="muted">${account ? 1 : 0} registro${account ? "" : "s"}</span></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Correo</th><th>Estado</th><th>Expediente</th></tr></thead><tbody>${account ? `<tr><td>${esc(account.profile?.name || "Registro sin completar")}<small>${account.id}</small></td><td>${esc(account.email)}<small>${account.verifiedAt ? "Correo verificado (demo)" : "Correo sin verificar"}</small></td><td>${status()}</td><td><button class="button small" id="open-dossier" ${!account.profile ? "disabled" : ""}>${icon("folder-open")}Revisar</button></td></tr>` : `<tr><td colspan="4" class="empty">No hay registros pendientes.</td></tr>`}</tbody></table></div>`;
      if ($("#open-dossier"))
        $("#open-dossier").onclick = () => {
          dossier = true;
          render();
        };
    }
    function review() {
      const p = account.profile;
      const actions =
        {
          pending: [
            ["activate", "Activar cuenta"],
            ["correct", "Pedir corrección"],
            ["close", "Cerrar cuenta"],
          ],
          correction: [["close", "Cerrar cuenta"]],
          active: [
            ["suspend", "Suspender cuenta"],
            ["close", "Cerrar cuenta"],
          ],
          suspended: [
            ["reactivate", "Reactivar cuenta"],
            ["close", "Cerrar cuenta"],
          ],
          closed: [],
        }[account.status] || [];
      main.innerHTML = `<button class="back" id="users-back">${icon("arrow-left")}Usuarios</button><div class="heading"><div><h1>${esc(p.name)}</h1><p>${account.id}</p></div>${status()}</div><div class="detail-layout"><div><section class="dossier-section"><h2>Identidad</h2><div class="data-grid">${datum("Correo verificado (demo)", account.email)}${datum("Número de cédula", p.cedula)}</div><div class="document-grid">${["front", "back"].map((side, i) => `<figure><figcaption>${i ? "Reverso" : "Frente"} de la cédula</figcaption><button class="document" data-photo="${side}" title="Ampliar ${i ? "reverso" : "frente"}" aria-label="Ampliar ${i ? "reverso" : "frente"}"><img src="${photo(p[side])}" alt="${i ? "Reverso" : "Frente"} del documento de ejemplo"></button></figure>`).join("")}</div></section><section class="dossier-section"><h2>Origen de fondos</h2>${datum("Actividad", p.source)}<p class="source-detail">${esc(p.detail)}</p><details><summary>Declaración y consentimientos aceptados</summary><p>${esc(p.declaration)}</p><p>Términos, privacidad y declaración: ${esc(p.version)}. Aceptados el ${stamp(p.acceptedAt)}.</p><button class="text-button" data-legal="terms">Ver términos</button> · <button class="text-button" data-legal="privacy">Ver privacidad</button></details></section><section class="dossier-section"><h2>Decisión de revisión</h2>${account.reason ? `<p class="notice">${esc(account.reason)}</p>` : ""}<div class="actions">${actions.map(([action, label], i) => `<button class="button ${i === 0 && ["activate", "reactivate"].includes(action) ? "primary" : ""} ${action === "close" ? "danger" : ""}" data-account-action="${action}">${icon({ activate: "check", reactivate: "check", correct: "pencil", suspend: "pause", close: "user-x" }[action])}${label}</button>`).join("")}</div>${account.status === "closed" ? `<p>Cuenta cerrada. El expediente permanece en el historial de esta demo.</p>` : ""}</section></div><aside class="detail-aside"><h2>Historial</h2><ol class="timeline">${account.events
        .slice()
        .reverse()
        .map((e) => `<li>${esc(e.message)}<small>${stamp(e.at)}</small></li>`)
        .join("")}</ol></aside></div>`;
      $("#users-back").onclick = () => {
        dossier = false;
        render();
      };
    }
    document.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.legal) {
        legal(b.dataset.legal);
        return;
      }
      if (b.dataset.photo && account?.profile) {
        showDialog(
          "Cédula de ejemplo",
          `<img class="full-document" src="${photo(account.profile[b.dataset.photo])}" alt="Documento de ejemplo ampliado">`,
        );
        return;
      }
      if (!b.dataset.accountAction || !account) return;
      const action = b.dataset.accountAction,
        label = b.textContent.trim();
      showDialog(
        label,
        `<form id="decision" class="stack">${["activate", "reactivate"].includes(action) ? `<label class="check"><input name="reviewed" type="checkbox" required>He revisado ambas caras de la cédula, el nombre y la declaración de fondos.</label>` : ""}<label class="field">Motivo de la decisión<textarea name="reason" minlength="5" maxlength="300" required></textarea><small>El motivo será visible para el cliente. No incluyas información confidencial de terceros.</small></label>${action === "close" ? `<p class="notice">El cierre impide nuevas solicitudes. No borra el historial ni resuelve obligaciones pendientes.</p>` : ""}<p class="form-error" role="alert" id="decision-error"></p><button class="button ${action === "close" ? "danger" : "primary"}" type="submit">Confirmar: ${label.toLowerCase()}</button></form>`,
      );
      $("#decision").onsubmit = (e) => {
        e.preventDefault();
        try {
          A.review(account, action, new FormData(e.target).get("reason"));
          $("#dialog").close();
          render();
          toast("Estado de la cuenta actualizado en la demo.");
        } catch (err) {
          $("#decision-error").textContent = err.message;
        }
      };
    });
    window.addEventListener("pagehide", release);
    return {
      client,
      admin,
      get: () => account,
      reset: () => {
        release();
        account = null;
        dossier = false;
      },
    };
  };
})();
