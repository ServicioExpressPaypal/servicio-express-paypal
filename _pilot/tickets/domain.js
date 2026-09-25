(function (root) {
  "use strict";
  const labels = { submitted: "Nueva", reviewing: "En revisión", quoted: "Cotizada", closed: "Cerrada", cancelled: "Cancelada" };
  const transitions = { submitted: ["reviewing", "cancelled"], reviewing: ["quoted", "cancelled"], quoted: ["closed", "cancelled"], closed: [], cancelled: [] };
  function cents(value) {
    const text = String(value).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error("Ingresa un monto válido con hasta dos decimales.");
    const [whole, fraction = ""] = text.split(".");
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(result) || result <= 0) throw new Error("El monto debe ser mayor que cero.");
    return result;
  }
  function addEvent(ticket, message, now = Date.now()) { ticket.events.push({ at: now, message }); }
  function transition(ticket, next, now = Date.now()) {
    if (!transitions[ticket.status]?.includes(next)) throw new Error("Ese cambio de estado no está disponible.");
    ticket.status = next;
    addEvent(ticket, labels[next], now);
  }
  function quote(ticket, { received, fee, rate, hours, validity }, now = Date.now()) {
    if (ticket.status !== "reviewing") throw new Error("Abre la revisión antes de cotizar.");
    const net = cents(received);
    const cost = String(fee) === "0" || String(fee) === "0.00" ? 0 : cents(fee);
    if (cost >= ticket.amount) throw new Error("La comisión debe ser menor que el monto solicitado.");
    if (!Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 168) throw new Error("El plazo debe estar entre 1 y 168 horas.");
    if (![30, 60, 120, 1440].includes(Number(validity))) throw new Error("Selecciona una vigencia válida.");
    const fx = Number(rate);
    if (ticket.currency === "NIO" && (!Number.isFinite(fx) || fx <= 0 || fx > 1000)) throw new Error("Ingresa un tipo de cambio válido.");
    if (ticket.currency === "USD" && net !== ticket.amount - cost) throw new Error("El neto debe coincidir con el monto menos la comisión total.");
    if (ticket.currency === "NIO" && Math.abs(net - Math.round((ticket.amount - cost) * fx)) > 1) throw new Error("Revisa el neto: debe coincidir con monto menos comisión, por tipo de cambio.");
    ticket.quote = { received: net, fee: cost, rate: ticket.currency === "USD" ? 1 : fx, hours: Number(hours), expiresAt: now + Number(validity) * 60000, createdAt: now };
    transition(ticket, "quoted", now);
    return ticket.quote;
  }
  function invoicePreview(ticket, merchant, description, now = Date.now()) {
    if (ticket.status !== "quoted" || !ticket.quote) throw new Error("Primero emite una cotización.");
    if (ticket.quote.expiresAt <= now) throw new Error("La cotización venció. Crea una solicitud nueva antes de facturar.");
    if (!description || description.trim().length < 10) throw new Error("Describe de forma precisa el concepto real de la factura.");
    return {
      detail: { invoice_number: ticket.id, reference: ticket.id, currency_code: "USD", payment_term: { term_type: "DUE_ON_RECEIPT" }, note: "Referencia de solicitud: " + ticket.id },
      invoicer: { business_name: merchant.name, email_address: merchant.email },
      primary_recipients: [{ billing_info: { name: { full_name: ticket.name }, email_address: ticket.email } }],
      items: [{ name: description.trim(), quantity: "1", unit_amount: { currency_code: "USD", value: (ticket.amount / 100).toFixed(2) } }],
      configuration: { partial_payment: { allow_partial_payment: false }, allow_tip: false }
    };
  }
  function message(ticket) {
    return `Hola ${ticket.name}, te contactamos por tu solicitud ${ticket.id} en Saldo Express Nicaragua. Estamos revisando los datos para responderte.`;
  }
  const api = { labels, cents, transition, quote, invoicePreview, message, addEvent };
  root.TicketModel = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
