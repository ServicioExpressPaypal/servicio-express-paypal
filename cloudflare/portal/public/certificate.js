export default (function () {
  "use strict";
  const version = "cuenta-minima-2026-09-27-v3";
  const ticketConditionsVersion = "ticket-condiciones-2026-09-27-v3";
  const title = "Certificado de regalo en efectivo";
  const presetAmounts = Object.freeze([50, 100, 200, 300, 400, 500]);
  const description =
    "Un regalo de valor monetario para compartir con tu familia o con un beneficiario que elijas. Su solicitud se gestiona de forma digital mediante un ticket con vigencia de 24 horas. Crear el ticket no completa la compra ni emite el certificado; el pago y la entrega se coordinan por separado.";
  const banks = ["LAFISE", "BDF", "Banpro", "BAC", "Ficohsa", "Avanz"];
  const ticketConditions = [
    "Solo se procesan órdenes pagadas con cuentas verificadas por PayPal.",
    "Debes crear un ticket por cada cuenta bancaria. No se permiten múltiples cuentas en una misma solicitud.",
    "Revisa cuidadosamente el nombre y el número de cuenta. Una transferencia ya ejecutada puede no ser reversible.",
    "No se aceptan números de tarjetas de crédito o débito ni cuentas de préstamos bancarios.",
    "No se aceptan solicitudes de personas menores de edad.",
    "Un dato incorrecto puede atrasar o impedir la atención del ticket.",
    "El Método Express tiene un límite de USD 500 por ticket. Los montos mayores se clasifican como Método internacional.",
    "Para montos mayores de USD 500, el plazo estimado es de 2 a 6 días hábiles desde la confirmación manual del pago. El contador considera lunes a viernes, hora de Nicaragua, sin ajuste por feriados. No confirma automáticamente la entrega ni extiende las 24 horas del ticket. Las fechas de confirmación de pago y entrega quedan en el historial.",
    "El nombre del beneficiario, banco, número de cuenta y comentarios se usan durante la vigencia del ticket. Al vencer, cerrarse o cancelarse dejan de estar disponibles y se eliminan de la base activa en la siguiente limpieza, programada cada 15 minutos. Conservamos referencia, montos, moneda, fechas, estado y la aceptación de condiciones. Las copias técnicas de recuperación pueden conservar versiones anteriores hasta 30 días.",
  ];
  const declaration =
    "Declaro que los datos son verdaderos, que el familiar o beneficiario me autorizó a proporcionarlos, que la cuenta bancaria indicada le pertenece y que los fondos relacionados con mi solicitud tienen procedencia lícita. Esta declaración no sustituye la verificación que corresponda.";
  const notice = [
    [
      "Cuenta y revisión",
      "Correo verificado, contraseña mediante hash y aceptación de condiciones. La activación es manual.",
    ],
    [
      "Ticket",
      "Vigencia de 24 horas. El nombre del beneficiario, banco, cuenta y comentarios son temporales; se ocultan al vencer o cerrar y se eliminan de la base activa en la siguiente limpieza, cada 15 minutos.",
    ],
    [
      "Historial",
      "Se conservan referencia, montos, moneda, fechas, estados y versión de condiciones aceptada. Los respaldos técnicos pueden conservar versiones anteriores hasta 30 días.",
    ],
    [
      "Proveedores y derechos",
      "Cloudflare aloja y protege el portal; Resend envía los correos. WhatsApp/Meta trata los mensajes que decidas enviar por ese canal. Responsable: SoftOhm Systems LLC. Contacto: info@softohmsystems.com.",
    ],
  ];
  function validate(data, now = Date.now()) {
    if (
      [
        "name",
        "cedula",
        "bank",
        "bankAccount",
        "currency",
        "phone",
        "front",
        "back",
      ].some((key) => key in data)
    )
      throw new Error(
        "El perfil no admite nombres, documentos ni datos bancarios.",
      );
    if (data.version !== version)
      throw new Error("El aviso cambió. Recarga y revisa su nueva versión.");
    if (
      ![data.declaration, data.terms, data.privacy].every(
        (v) => v === true || v === "on",
      )
    )
      throw new Error("Acepta las condiciones y el aviso de privacidad.");
    return {
      kind: "minimal-account",
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
  const api = {
    presetAmounts,
    version,
    title,
    description,
    banks,
    ticketConditions,
    ticketConditionsVersion,
    declaration,
    notice,
    validate,
    validateTicket,
  };
  return api;
})();
