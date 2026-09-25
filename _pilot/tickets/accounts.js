(function (root) {
  "use strict";
  const version = "borrador-2026-09-23";
  const labels = {
    unverified: "Verifica tu correo",
    incomplete: "Completa tus datos",
    pending: "Pendiente de revisión",
    correction: "Necesita corrección",
    active: "Activa",
    suspended: "Suspendida",
    closed: "Cerrada",
  };
  const sources = [
    "Salario",
    "Servicios profesionales",
    "Actividad comercial",
    "Ahorros",
    "Otro",
  ];
  const declaration =
    "Declaro, bajo mi responsabilidad, que la información proporcionada es verdadera, que los fondos previstos proceden de actividades lícitas y que actúo por cuenta propia. Me comprometo a acreditar su origen cuando se me solicite y a informar cualquier cambio. Entiendo que esta declaración no sustituye las comprobaciones que correspondan.";
  const terms = [
    [
      "Cuenta personal",
      "Debes proporcionar información veraz y actualizada, proteger tus credenciales y utilizar únicamente tu propia cuenta. La verificación de correo no activa la cuenta: el equipo debe revisar y aprobar la solicitud.",
    ],
    [
      "Uso permitido",
      "No se permite suplantación de identidad, documentos alterados, fraude, fondos de origen ilícito, operaciones por cuenta de terceros no autorizadas ni uso contrario a la ley o a las condiciones aplicables de los proveedores de pago. Las solicitudes están sujetas a revisión y disponibilidad.",
    ],
    [
      "Suspensión y cierre",
      "Saldo Express se reserva el derecho de restringir, suspender o cerrar la cuenta por incumplimiento de estas condiciones, información falsa, riesgos de seguridad o requerimientos legales. La medida será proporcional al caso. Se comunicará el motivo y un canal de revisión, salvo impedimento legal. El usuario podrá solicitar revisión mediante el canal de atención que se habilite antes del lanzamiento.",
    ],
    [
      "Obligaciones pendientes",
      "El cierre no supone confiscación de fondos, renuncia a derechos ni eliminación automática de obligaciones o reclamaciones pendientes. Tampoco implica borrar inmediatamente expedientes que deban conservarse por una obligación legal. El tratamiento y eliminación de datos seguirá la política de privacidad y los plazos aplicables.",
    ],
    [
      "Solicitudes y cotizaciones",
      "Crear un ticket no confirma una operación, un pago, una reserva de fondos ni un plazo de entrega. Cualquier operación posterior requerirá condiciones específicas y los requisitos legales y del proveedor que correspondan.",
    ],
    [
      "Borrador para revisión",
      "Documento de demostración. Antes de su uso real deben completarse la razón social, domicilio, canales de atención y reclamación, jurisdicción y demás información aplicable, y obtener revisión legal local. Aceptar este borrador no autoriza a operar un servicio regulado.",
    ],
  ];
  const privacy = [
    [
      "Datos y finalidad",
      "Se propone solicitar nombre completo, correo, número de cédula, imágenes de ambas caras y declaración de origen de fondos para revisar la solicitud de cuenta, prevenir usos indebidos y gestionar solicitudes. No se autoriza el uso publicitario de estos documentos.",
    ],
    [
      "Acceso y conservación",
      "En producción, solo el personal autorizado deberá acceder al expediente. Los avisos por correo o mensajería contendrán únicamente una referencia, nunca imágenes de cédula ni datos bancarios. El plazo de conservación y sus fundamentos deben establecerse antes del lanzamiento; no se propone una conservación indefinida.",
    ],
    [
      "Derechos y responsable",
      "Antes de recopilar datos reales se deben identificar el responsable, domicilio, contacto de privacidad, proveedores, países de tratamiento, bases aplicables y procedimiento para ejercer derechos de acceso, rectificación y supresión cuando proceda. Estos datos no están todavía definidos en este borrador.",
    ],
    [
      "Esta demostración",
      "Los datos y las imágenes permanecen temporalmente en la memoria de este navegador. No hay envío a servidores ni almacenamiento persistente. Al recargar se pierden. Utiliza exclusivamente información e imágenes ficticias.",
    ],
  ];
  function event(account, message, now = Date.now()) {
    account.events.push({ at: now, message });
  }
  function register(email, password, now = Date.now()) {
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new Error("Revisa el correo electrónico.");
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      throw new Error("Usa una contraseña de entre 12 y 128 caracteres.");
    // State-machine demo only: never retain a password or claim authentication.
    return {
      id: "USR-DEMO",
      email,
      status: "unverified",
      verifiedAt: null,
      profile: null,
      reason: "",
      events: [{ at: now, message: "Registro de ejemplo creado" }],
    };
  }
  function verify(account, now = Date.now()) {
    if (account.status !== "unverified")
      throw new Error("El correo ya fue verificado en la demostración.");
    account.verifiedAt = now;
    account.status = "incomplete";
    event(account, "Correo verificado (simulación)", now);
  }
  function checkPhoto(photo) {
    if (
      !photo ||
      !["image/jpeg", "image/png"].includes(photo.type) ||
      photo.size <= 0 ||
      photo.size > 5 * 1024 * 1024
    )
      throw new Error(
        "Adjunta cada cara de la cédula en JPG o PNG, de hasta 5 MB.",
      );
  }
  function submit(account, data, now = Date.now()) {
    if (
      !account.verifiedAt ||
      !["incomplete", "correction"].includes(account.status)
    )
      throw new Error("Verifica el correo antes de enviar tus datos.");
    const name = String(data.name || "")
      .trim()
      .replace(/\s+/g, " ");
    if (name.length < 5 || name.length > 120 || name.split(" ").length < 2)
      throw new Error("Escribe tu nombre completo como aparece en tu cédula.");
    const cedula = String(data.cedula || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]/g, "");
    // Syntax is not proof of document authenticity.
    if (!/^\d{13}[A-Z]$/.test(cedula))
      throw new Error("Revisa el número de cédula: 13 dígitos y una letra.");
    if (!sources.includes(data.source))
      throw new Error("Selecciona el origen de los fondos.");
    const detail = String(data.detail || "").trim();
    if (detail.length < 15 || detail.length > 600)
      throw new Error(
        "Describe el origen de los fondos en entre 15 y 600 caracteres.",
      );
    checkPhoto(data.front);
    checkPhoto(data.back);
    if (
      ![data.declaration, data.terms, data.privacy].every(
        (value) => value === true || value === "on",
      )
    )
      throw new Error(
        "Confirma la declaración, los términos y el tratamiento de datos.",
      );
    account.profile = {
      name,
      cedula,
      source: data.source,
      detail,
      front: data.front,
      back: data.back,
      acceptedAt: now,
      version,
      declaration,
    };
    account.status = "pending";
    account.reason = "";
    event(account, "Expediente enviado a revisión manual", now);
  }
  function review(account, action, reason = "", now = Date.now()) {
    const allowed = {
      activate: ["pending"],
      correct: ["pending"],
      suspend: ["active"],
      reactivate: ["suspended"],
      close: ["pending", "correction", "active", "suspended"],
    };
    if (!allowed[action]?.includes(account.status))
      throw new Error("Esta acción no está disponible para el estado actual.");
    if (!account.verifiedAt || !account.profile)
      throw new Error("Falta verificar el correo o completar el expediente.");
    reason = String(reason).trim();
    if (reason.length < 5 || reason.length > 300)
      throw new Error("Registra un motivo de entre 5 y 300 caracteres.");
    account.status = {
      activate: "active",
      correct: "correction",
      suspend: "suspended",
      reactivate: "active",
      close: "closed",
    }[action];
    account.reason = reason;
    event(account, labels[account.status] + ": " + reason, now);
  }
  function requireActive(account) {
    if (
      !account ||
      account.status !== "active" ||
      !account.verifiedAt ||
      !account.profile
    )
      throw new Error("Tu cuenta debe estar activada para crear solicitudes.");
  }
  const api = {
    version,
    labels,
    sources,
    declaration,
    terms,
    privacy,
    register,
    verify,
    submit,
    review,
    requireActive,
    checkPhoto,
  };
  root.AccountModel = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
