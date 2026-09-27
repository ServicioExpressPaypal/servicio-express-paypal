export default (function () {
  "use strict";
  const version = "certificado-efectivo-2026-09-26-v8";
  const ticketConditionsVersion = "ticket-condiciones-2026-09-26-v1";
  const title = "Certificado de regalo en efectivo";
  const description =
    "Solicitud prevista de un Certificado de regalo en efectivo para obsequiar a un familiar o beneficiario en Nicaragua. Cada ticket tiene una vigencia de 24 horas y permite comentarios entre el cliente y el administrador. La compra y el pago se coordinan fuera del portal por WhatsApp. El producto no está disponible.";
  const banks = ["LAFISE", "BDF", "Banpro", "BAC", "Ficohsa", "Avanz"];
  const ticketConditions = [
    "Solo se procesan órdenes pagadas con cuentas verificadas por PayPal.",
    "Debes crear un ticket por cada cuenta bancaria. No se permiten múltiples cuentas en una misma solicitud.",
    "Revisa cuidadosamente el nombre y el número de cuenta. Una transferencia ya ejecutada puede no ser reversible.",
    "No se aceptan números de tarjetas de crédito o débito ni cuentas de préstamos bancarios.",
    "No se aceptan solicitudes de personas menores de edad.",
    "Un dato incorrecto puede atrasar o impedir la atención del ticket.",
    "El Método Express tiene un límite de USD 500 por ticket. Los montos mayores se clasifican como Método internacional.",
  ];
  const declaration =
    "Declaro que los datos son verdaderos, que el familiar o beneficiario me autorizó a proporcionarlos, que la cuenta bancaria indicada le pertenece y que los fondos relacionados con mi solicitud tienen procedencia lícita. Esta declaración no sustituye la verificación que corresponda.";
  const notice = [
    [
      "Servicio solicitado",
      description +
        " Hasta $500 se tramitaría como certificado; un monto mayor genera una solicitud por Método internacional. Crear una cuenta o ticket no ejecuta un pago ni garantiza un depósito.",
    ],
    [
      "Cuenta y revisión",
      "Se requiere verificar el correo y obtener aprobación manual. Cada solicitud admite un solo familiar o beneficiario en Nicaragua y una sola cuenta bancaria a su nombre. La activación permite solicitar cotizaciones; no certifica cumplimiento legal ni autoriza por sí sola una operación.",
    ],
    [
      "Ticket y conversación",
      "Cada ticket vence 24 horas después de su creación. Durante su vigencia, el cliente y el administrador pueden intercambiar comentarios relacionados con la solicitud. Los mensajes no confirman una compra, un pago ni un depósito. La eventual compra se coordina fuera del portal mediante el canal oficial de WhatsApp.",
    ],
    [
      "Datos recopilados",
      "La cuenta utiliza correo, contraseña almacenada mediante hash, sesiones y registros de seguridad. Cada ticket solicita el nombre del familiar o beneficiario, banco, número de cuenta y moneda. El comprador debe contar con autorización para proporcionar esos datos. No se solicita número de cédula, fotografías de documentos, PIN ni claves bancarias. Los datos proporcionados se guardan en servidores para gestionar la cuenta y las solicitudes.",
    ],
    [
      "Acceso y proveedores",
      "El personal autorizado revisa los datos. Proveedores de alojamiento, almacenamiento, correo transaccional y mensajería operativa procesan la información necesaria para sus funciones, posiblemente fuera de Nicaragua. Los avisos al equipo pueden contener la referencia, monto, valor estimado, modalidad y vencimiento del ticket, pero no el número de cuenta bancaria ni contraseñas.",
    ],
    [
      "Uso permitido",
      "No se admite suplantación, información falsa, fondos ilícitos ni cuentas de terceros. Ante incumplimientos o riesgos, el acceso puede restringirse, suspenderse o cerrarse con un motivo registrado y posibilidad de revisión cuando proceda. Esto no autoriza la apropiación de fondos ni la renuncia a derechos.",
    ],
    [
      "Conservación y derechos",
      "Cerrar una cuenta no equivale a borrar inmediatamente todos los datos. La conservación debe limitarse a lo necesario y justificado, con plazos definidos y atención a solicitudes de acceso, rectificación y eliminación cuando correspondan. No se autoriza conservación indefinida.",
    ],
    [
      "Piloto cerrado",
      "Registro y recepción de perfiles cerrados. Responsable: SoftOhm Systems LLC. Contacto: info@softohmsystems.com. Antes de admitir clientes deben completarse la identificación del responsable, los plazos de conservación y la revisión jurídica de requisitos y autorizaciones. No se ofrecen compras, emisión ni canje en esta etapa.",
    ],
  ];
  function validate(data, now = Date.now()) {
    if ("cedula" in data)
      throw new Error(
        "Este formulario no solicita ni admite número de cédula.",
      );
    const text = (key) =>
      typeof data[key] === "string" ? data[key].trim() : "";
    const name = text("name").replace(/\s+/g, " ");
    if (name.length < 5 || name.length > 120 || name.split(" ").length < 2)
      throw new Error(
        "Escribe el nombre completo del familiar o beneficiario.",
      );
    const bank = text("bank"),
      currency = text("currency");
    if (!banks.includes(bank) || !["USD", "NIO"].includes(currency))
      throw new Error("Selecciona el banco y la moneda de la cuenta.");
    const bankAccount = text("bankAccount").replace(/[\s-]/g, "");
    if (!/^\d{6,30}$/.test(bankAccount))
      throw new Error(
        "Revisa el número de cuenta bancaria, no el número de tarjeta.",
      );
    let phone = text("phone").replace(/[\s()-]/g, "");
    if (/^\d{8}$/.test(phone)) phone = "+505" + phone;
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw new Error("Escribe un teléfono válido con código de país.");
    if (data.version !== version)
      throw new Error("El aviso cambió. Recarga y revisa su nueva versión.");
    if (
      ![data.declaration, data.terms, data.privacy].every(
        (v) => v === true || v === "on",
      )
    )
      throw new Error(
        "Confirma la autorización del beneficiario, los términos y el aviso de privacidad.",
      );
    return {
      kind: "cash-certificate",
      name,
      bank,
      bankAccount,
      currency,
      phone,
      declaration,
      version,
      acceptedAt: now,
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
