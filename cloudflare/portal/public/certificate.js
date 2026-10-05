export default (function () {
  "use strict";
  // v8 clarifies that the customer process stays in the portal and WhatsApp is
  // only a support channel. It adds no data, purposes or recipients, so it is
  // not a material change: existing accounts keep the version they accepted
  // (for example v7) in registration_consents. A material change needs a
  // renewed acceptance flow.
  const version = "cuenta-revision-2026-10-05-v8";
  const reviewNotice =
    "Revisaremos tu solicitud en un plazo de hasta 2 días hábiles, de lunes a viernes, después de verificar tu correo y completar el formulario. Te notificaremos por correo si fue aprobada, rechazada o necesita aclaraciones. Hasta su aprobación no podrás crear tickets.";
  const ticketConditionsVersion = "ticket-condiciones-2026-10-05-v7";
  const extendedInternationalValidityVersions = new Set([
    "ticket-condiciones-2026-09-30-v5",
    "ticket-condiciones-2026-10-04-v6",
    ticketConditionsVersion,
  ]);
  const title = "Certificado de regalo en efectivo";
  const supportEmail = "soportesaldoexpress@gmail.com";
  const presetAmounts = Object.freeze([50, 100, 200, 300, 400, 500]);
  const description =
    "Un regalo de valor monetario para compartir con tu familia o con un beneficiario que elijas. La solicitud, el pago, el seguimiento y la entrega se gestionan mediante un ticket dentro de la plataforma. Crear el ticket no completa la compra ni emite el certificado.";
  const banks = ["LAFISE", "BDF", "Banpro", "BAC", "Ficohsa", "Avanz"];
  const ticketConditions = [
    "Solo se procesan órdenes pagadas con cuentas verificadas por PayPal.",
    "Debes crear un ticket por cada cuenta bancaria. No se permiten múltiples cuentas en una misma solicitud.",
    "Revisa cuidadosamente el nombre y el número de cuenta. Una transferencia ya ejecutada puede no ser reversible.",
    "No se aceptan números de tarjetas de crédito o débito ni cuentas de préstamos bancarios.",
    "No se aceptan solicitudes de personas menores de edad.",
    "Un dato incorrecto puede atrasar o impedir la atención del ticket.",
    "El Método Express tiene un límite de USD 500 por ticket. Los montos mayores se clasifican como Método internacional.",
    "Turnos: los tickets creados con estas condiciones se atienden por orden de creación. Cuando es el turno de tu ticket tienes 2 minutos para pagar; si hay otros tickets esperando y no se confirma el pago, tu ticket pasa al final de la fila. Si no hay otros tickets esperando, tu turno no vence.",
    "Express: vigencia de 24 horas desde la creación. Método internacional (más de USD 500): vigencia de 6 días hábiles desde la creación; al confirmar manualmente el pago durante la vigencia, el vencimiento pasa a 6 días hábiles desde esa confirmación. La entrega internacional se estima entre 2 y 6 días hábiles desde el pago confirmado. El contador usa lunes a viernes, hora de Nicaragua, sin ajuste por feriados. Vencer no confirma la entrega ni extingue una operación pagada pendiente.",
    "Revisa los datos y el importe antes de pagar. No se ofrecen reembolsos voluntarios por cambio de opinión ni por errores en datos suministrados por el comprador cuando el envío ya se ejecutó conforme a ellos. Antes del envío, solicita la revisión de cualquier error. Esta regla no excluye devoluciones por servicio no prestado, cobro duplicado, error atribuible al operador ni derechos irrenunciables o mecanismos de reclamación de PayPal. Crear un ticket no genera por sí mismo un cobro.",
    "El nombre del beneficiario, banco, número de cuenta y comentarios se usan durante la vigencia del ticket. Al vencer, cerrarse o cancelarse dejan de estar disponibles y se eliminan de la base activa en la siguiente limpieza, programada cada 15 minutos. Conservamos referencia, montos, moneda, fechas, estado y la aceptación de condiciones. Las copias técnicas de recuperación pueden conservar versiones anteriores hasta 30 días.",
  ];
  const declaration =
    "Declaro que los datos son verdaderos, que el familiar o beneficiario me autorizó a proporcionarlos, que la cuenta bancaria indicada le pertenece y que los fondos relacionados con mi solicitud tienen procedencia lícita. Esta declaración no sustituye la verificación que corresponda.";
  const notice = [
    [
      "Cuenta y revisión",
      "Nombre completo, teléfono de contacto, correo verificado, contraseña mediante hash y aceptación de condiciones. La activación es manual.",
    ],
    [
      "Ticket",
      "Express: 24 horas. Internacional: 6 días hábiles desde la creación o, si se confirma el pago mientras está vigente, desde esa confirmación. Los datos de destino y comentarios se ocultan al vencer, cerrar o cancelar y se eliminan de la base activa en la siguiente limpieza, cada 15 minutos.",
    ],
    [
      "Historial",
      "Se conservan referencia, montos, moneda, fechas, estados y versión de condiciones aceptada. Los respaldos técnicos pueden conservar versiones anteriores hasta 30 días.",
    ],
    [
      "Proveedores y derechos",
      `Cloudflare aloja y protege el portal; Resend envía los correos. WhatsApp/Meta trata los mensajes que decidas enviar por ese canal. Responsable: SoftOhm Systems LLC. Contacto: ${supportEmail}.`,
    ],
  ];
  function contact(data) {
    if (
      [
        "name",
        "cedula",
        "bank",
        "bankAccount",
        "currency",
        "paypalEmail",
        "paypal_email",
        "front",
        "back",
      ].some((key) => key in data)
    )
      throw new Error(
        "El perfil no admite documentos, correo separado de PayPal ni datos bancarios.",
      );
    const fullName =
      typeof data.fullName === "string"
        ? data.fullName.trim().replace(/\s+/g, " ")
        : "";
    if (
      fullName.length < 5 ||
      fullName.length > 120 ||
      fullName.split(" ").length < 2 ||
      !/^[\p{L}\p{M} .'-]+$/u.test(fullName)
    )
      throw new Error("Escribe tu nombre completo, con nombres y apellidos.");
    const phone =
      typeof data.phone === "string"
        ? data.phone.trim().replace(/[ ()-]/g, "")
        : "";
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw new Error(
        "Escribe el teléfono con +, código de país y número completo.",
      );
    return { fullName, phone };
  }
  function registration(data, now = Date.now()) {
    if (data.legalAccepted !== true || data.legalVersion !== version)
      throw new Error("Acepta los términos y el aviso de privacidad vigentes.");
    return {
      ...contact(data),
      kind: "review-account",
      version,
      acceptedAt: now,
    };
  }
  function validate(data, now = Date.now()) {
    const details = contact(data);
    if (data.version !== version)
      throw new Error("El aviso cambió. Recarga y revisa su nueva versión.");
    if (
      ![data.declaration, data.terms, data.privacy].every(
        (v) => v === true || v === "on",
      )
    )
      throw new Error("Acepta las condiciones y el aviso de privacidad.");
    return {
      ...details,
      kind: "review-account",
      version,
      acceptedAt: now,
      declaration:
        "Declaro que soy mayor de edad y acepto el uso permitido del portal.",
    };
  }
  function validateTicket(data, now = Date.now()) {
    const text = (key) =>
      typeof data[key] === "string" ? data[key].trim() : "";
    const beneficiaryName = text("beneficiaryName").replace(/\s+/g, " ");
    if (
      beneficiaryName.length < 5 ||
      beneficiaryName.length > 120 ||
      beneficiaryName.split(" ").length < 2
    )
      throw new Error("Escribe el nombre completo del beneficiario.");
    const bank = text("bank"),
      currency = text("currency");
    if (!banks.includes(bank) || !["USD", "NIO"].includes(currency))
      throw new Error("Selecciona el banco y la moneda de la cuenta.");
    const bankAccount = text("bankAccount").replace(/[\s-]/g, "");
    if (!/^\d{6,30}$/.test(bankAccount))
      throw new Error(
        "Revisa el número de cuenta bancaria. No escribas un número de tarjeta.",
      );
    if (data.conditionsVersion !== ticketConditionsVersion)
      throw new Error(
        "Las condiciones del ticket cambiaron. Recarga y revísalas nuevamente.",
      );
    if (data.paypalOwnership !== true)
      throw new Error(
        "Confirma que usarás una cuenta de PayPal propia, a tu nombre.",
      );
    if (data.consent !== true || data.conditionsAccepted !== true)
      throw new Error(
        "Debes aceptar las condiciones antes de crear el ticket.",
      );
    return {
      beneficiaryName,
      bank,
      bankAccount,
      currency,
      termsVersion: ticketConditionsVersion,
      termsAcceptedAt: now,
    };
  }
  function hasExtendedInternationalValidity(termsVersion) {
    return extendedInternationalValidityVersions.has(termsVersion);
  }
  const api = {
    presetAmounts,
    version,
    reviewNotice,
    registration,
    title,
    supportEmail,
    description,
    banks,
    ticketConditions,
    ticketConditionsVersion,
    hasExtendedInternationalValidity,
    declaration,
    notice,
    validate,
    validateTicket,
  };
  return api;
})();
