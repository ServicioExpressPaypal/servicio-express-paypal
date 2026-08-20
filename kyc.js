const SUPABASE_URL = "https://vwsrjsaeizmttitnbgnz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3c3Jqc2FlaXptdHRpdG5iZ256Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxOTIzMjIsImV4cCI6MjEwMjc2ODMyMn0.N0cavh18h4hqW6OueVFIQJNYKfkniAmP-VXqzKzooik";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (selector) => document.querySelector(selector);

const els = {
  authForm: $("#authForm"),
  authEmail: $("#authEmail"),
  authPassword: $("#authPassword"),
  signUpButton: $("#signUpButton"),
  signOutButton: $("#signOutButton"),
  sessionStatus: $("#sessionStatus"),
  authMessage: $("#authMessage"),
  kycCard: $("#kycCard"),
  kycForm: $("#kycForm"),
  kycStatus: $("#kycStatus"),
  kycMessage: $("#kycMessage"),
  verifiedCard: $("#verifiedCard"),
  adminCard: $("#adminCard"),
  adminList: $("#adminList"),
  refreshAdminButton: $("#refreshAdminButton"),
  nameMatchBox: $("#nameMatchBox"),
};

const fields = {
  legalName: $("#legalName"),
  cedulaNumber: $("#cedulaNumber"),
  phone: $("#phone"),
  paypalEmail: $("#paypalEmail"),
  paypalHolder: $("#paypalHolder"),
  bankName: $("#bankName"),
  bankAccount: $("#bankAccount"),
  bankHolder: $("#bankHolder"),
  ownAccounts: $("#ownAccounts"),
  privacyAccepted: $("#privacyAccepted"),
  termsAccepted: $("#termsAccepted"),
};

function setMessage(node, message = "", type = "") {
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function statusLabel(status) {
  const labels = {
    pending: "En revisión",
    approved: "Aprobado",
    rejected: "Rechazado",
    blocked: "Bloqueado",
  };
  return labels[status] || "Sin enviar";
}

function setStatusPill(node, status) {
  if (!node) return;
  node.textContent = statusLabel(status);
  node.className = `status-pill ${status || ""}`;
}

function namesMatch() {
  const legal = normalizeName(fields.legalName.value);
  const paypal = normalizeName(fields.paypalHolder.value);
  const bank = normalizeName(fields.bankHolder.value);

  if (!legal || !paypal || !bank) return null;
  return legal === paypal && legal === bank;
}

function updateNameMatchBox() {
  const result = namesMatch();
  if (!els.nameMatchBox) return;

  els.nameMatchBox.classList.remove("ok", "warning");
  if (result === null) {
    els.nameMatchBox.querySelector("p").textContent =
      "El sistema verificará que los tres nombres coincidan antes de enviar.";
    return;
  }

  if (result) {
    els.nameMatchBox.classList.add("ok");
    els.nameMatchBox.querySelector("p").textContent =
      "Los nombres coinciden. La solicitud quedará lista para revisión manual.";
  } else {
    els.nameMatchBox.classList.add("warning");
    els.nameMatchBox.querySelector("p").textContent =
      "Los nombres no coinciden. La cédula, PayPal y cuenta bancaria deben estar a nombre de la misma persona.";
  }
}

function fillKycForm(profile) {
  if (!profile) return;
  fields.legalName.value = profile.legal_name || "";
  fields.cedulaNumber.value = profile.cedula_number || "";
  fields.phone.value = profile.phone || "";
  fields.paypalEmail.value = profile.paypal_email || "";
  fields.paypalHolder.value = profile.paypal_account_holder || "";
  fields.bankName.value = profile.bank_name || "";
  fields.bankAccount.value = profile.bank_account_number || "";
  fields.bankHolder.value = profile.bank_account_holder || "";
  fields.ownAccounts.checked = Boolean(profile.user_attests_own_accounts);
  fields.privacyAccepted.checked = Boolean(profile.privacy_accepted);
  fields.termsAccepted.checked = Boolean(profile.terms_accepted);
  updateNameMatchBox();
}

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function loadProfileAndKyc() {
  const session = await getSession();

  els.kycCard.hidden = !session;
  els.signOutButton.hidden = !session;
  els.sessionStatus.textContent = session ? "Con sesión" : "Sin sesión";

  if (!session) {
    els.adminCard.hidden = true;
    els.verifiedCard.hidden = true;
    setStatusPill(els.kycStatus, null);
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("id,email,role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileError) {
    setMessage(els.authMessage, `No se pudo leer el perfil: ${profileError.message}`, "error");
  }

  const isAdmin = profile?.role === "admin";
  els.adminCard.hidden = !isAdmin;
  if (isAdmin) await loadAdminList();

  const { data: kyc, error: kycError } = await supabaseClient
    .from("kyc_profiles")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (kycError) {
    setMessage(els.kycMessage, `No se pudo leer tu verificación: ${kycError.message}`, "error");
    return;
  }

  if (kyc) {
    fillKycForm(kyc);
    setStatusPill(els.kycStatus, kyc.status);
    els.verifiedCard.hidden = kyc.status !== "approved";

    if (kyc.status === "approved") {
      setMessage(els.kycMessage, "Tu cuenta ya está aprobada.", "success");
    } else if (kyc.status === "rejected") {
      setMessage(els.kycMessage, kyc.review_notes || "Tu solicitud fue rechazada. Puedes corregir y reenviar.", "warning");
    } else if (kyc.status === "blocked") {
      setMessage(els.kycMessage, kyc.review_notes || "Tu cuenta está bloqueada para revisión.", "error");
    } else {
      setMessage(els.kycMessage, "Tu solicitud está en revisión manual.", "success");
    }
  } else {
    setStatusPill(els.kycStatus, null);
    els.verifiedCard.hidden = true;
    setMessage(els.kycMessage, "Completa el formulario para enviar tu verificación.", "");
  }
}

async function handleSignUp() {
  setMessage(els.authMessage, "Creando cuenta...", "");

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    setMessage(els.authMessage, error.message, "error");
    return;
  }

  setMessage(
    els.authMessage,
    "Cuenta creada. Si Supabase solicita confirmación, revisa tu correo antes de iniciar sesión.",
    "success"
  );
  await loadProfileAndKyc();
}

async function handleSignIn(event) {
  event.preventDefault();
  setMessage(els.authMessage, "Iniciando sesión...", "");

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setMessage(els.authMessage, error.message, "error");
    return;
  }

  setMessage(els.authMessage, "Sesión iniciada.", "success");
  await loadProfileAndKyc();
}

async function handleSignOut() {
  await supabaseClient.auth.signOut();
  setMessage(els.authMessage, "Sesión cerrada.", "success");
  await loadProfileAndKyc();
}

async function handleKycSubmit(event) {
  event.preventDefault();
  setMessage(els.kycMessage, "Validando datos...", "");

  if (!namesMatch()) {
    setMessage(
      els.kycMessage,
      "No se puede enviar: el nombre legal, el titular PayPal y el titular bancario deben coincidir.",
      "error"
    );
    return;
  }

  const payload = {
    p_legal_name: fields.legalName.value,
    p_cedula_number: fields.cedulaNumber.value,
    p_phone: fields.phone.value,
    p_paypal_email: fields.paypalEmail.value,
    p_paypal_account_holder: fields.paypalHolder.value,
    p_bank_name: fields.bankName.value,
    p_bank_account_number: fields.bankAccount.value,
    p_bank_account_holder: fields.bankHolder.value,
    p_user_attests_own_accounts: fields.ownAccounts.checked,
    p_privacy_accepted: fields.privacyAccepted.checked,
    p_terms_accepted: fields.termsAccepted.checked,
  };

  const { error } = await supabaseClient.rpc("submit_kyc", payload);
  if (error) {
    setMessage(els.kycMessage, `No se pudo enviar: ${error.message}`, "error");
    return;
  }

  setMessage(els.kycMessage, "Verificación enviada. Queda pendiente de revisión manual.", "success");
  await loadProfileAndKyc();
}

function mask(value = "") {
  const text = String(value);
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function adminItemTemplate(row) {
  const status = row.status || "pending";
  return `
    <article class="admin-item" data-user-id="${row.user_id}">
      <div class="admin-item-main">
        <strong>${row.legal_name}</strong>
        <span>${row.paypal_email} · ${row.bank_name} · Cuenta ${mask(row.bank_account_number)}</span>
        <small>Cédula ${mask(row.cedula_number)} · PayPal: ${row.paypal_account_holder} · Banco: ${row.bank_account_holder}</small>
      </div>
      <span class="status-pill ${status}">${statusLabel(status)}</span>
      <textarea placeholder="Nota interna de revisión">${row.review_notes || ""}</textarea>
      <div class="admin-actions">
        <button class="button primary" data-review="approved" type="button">Aprobar</button>
        <button class="button secondary-dark" data-review="rejected" type="button">Rechazar</button>
        <button class="button ghost" data-review="blocked" type="button">Bloquear</button>
      </div>
    </article>
  `;
}

async function loadAdminList() {
  if (!els.adminList) return;
  els.adminList.innerHTML = "<p class=\"kyc-muted\">Cargando solicitudes...</p>";

  const { data, error } = await supabaseClient
    .from("kyc_profiles")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (error) {
    els.adminList.innerHTML = `<p class="form-message" data-type="error">${error.message}</p>`;
    return;
  }

  if (!data?.length) {
    els.adminList.innerHTML = "<p class=\"kyc-muted\">No hay solicitudes KYC todavía.</p>";
    return;
  }

  els.adminList.innerHTML = data.map(adminItemTemplate).join("");
  els.adminList.querySelectorAll("[data-review]").forEach((button) => {
    button.addEventListener("click", () => reviewFromButton(button));
  });
}

async function reviewFromButton(button) {
  const item = button.closest(".admin-item");
  const userId = item?.dataset.userId;
  const status = button.dataset.review;
  const notes = item?.querySelector("textarea")?.value || "";
  if (!userId || !status) return;

  button.disabled = true;
  button.textContent = "Guardando...";

  const { error } = await supabaseClient.rpc("review_kyc", {
    p_user_id: userId,
    p_status: status,
    p_notes: notes,
  });

  if (error) {
    alert(`No se pudo actualizar: ${error.message}`);
  }

  await loadAdminList();
}

function wireKycPage() {
  els.authForm?.addEventListener("submit", handleSignIn);
  els.signUpButton?.addEventListener("click", handleSignUp);
  els.signOutButton?.addEventListener("click", handleSignOut);
  els.kycForm?.addEventListener("submit", handleKycSubmit);
  els.refreshAdminButton?.addEventListener("click", loadAdminList);

  [fields.legalName, fields.paypalHolder, fields.bankHolder].forEach((input) => {
    input?.addEventListener("input", updateNameMatchBox);
  });

  supabaseClient.auth.onAuthStateChange(() => {
    loadProfileAndKyc();
  });

  loadProfileAndKyc();
}

wireKycPage();
