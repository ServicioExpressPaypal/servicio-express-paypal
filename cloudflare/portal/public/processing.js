const MANAGUA_OFFSET = 6 * 60 * 60 * 1000;

export function deliveryAmount(ticket, exchangeRate) {
  // Preserve amounts already agreed through the previous quotation workflow.
  if (ticket.quote)
    return {
      netUSD: ticket.amount - ticket.quote.fee,
      received: ticket.quote.received,
      rate: ticket.quote.rate,
      currency: ticket.currency,
    };
  const net = ticket.estimate.net;
  if (!Number.isSafeInteger(net) || net <= 0)
    throw new Error("El monto del ticket no es válido.");
  if (ticket.currency === "USD")
    return { netUSD: net, received: net, rate: 1, currency: "USD" };
  const value = String(exchangeRate ?? "");
  if (
    !/^\d{1,4}(\.\d{1,4})?$/.test(value) ||
    Number(value) <= 0 ||
    Number(value) > 1000
  )
    throw new Error(
      "Ingresa el tipo de cambio aplicado, mayor que cero y con hasta cuatro decimales.",
    );
  const scaledRate = Math.round(Number(value) * 10000);
  return {
    netUSD: net,
    received: Math.round((net * scaledRate) / 10000),
    rate: scaledRate / 10000,
    currency: "NIO",
  };
}

export function ticketStage(ticket, now = Date.now()) {
  if (ticket.status === "cancelled") return "cancelled";
  if (ticket.processing_completed_at) return "delivered";
  if (ticket.processing_started_at) return "paid";
  if (ticket.status === "closed") return "closed";
  return ticket.expires_at <= now ? "expired" : ticket.status;
}

// Preserve the local confirmation time; Nicaragua uses UTC-6 without DST.
export function addBusinessDays(timestamp, days) {
  const local = new Date(timestamp - MANAGUA_OFFSET);
  while (days > 0) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (![0, 6].includes(local.getUTCDay())) days--;
  }
  return local.getTime() + MANAGUA_OFFSET;
}

export function ticketExpiry(amount, timestamp) {
  return amount > 50000
    ? addBusinessDays(timestamp, 6)
    : timestamp + 24 * 60 * 60 * 1000;
}

export function processingWindow(ticket, now = Date.now()) {
  if (ticket.amount <= 50000) return null;
  const start = ticket.processing_started_at;
  if (!start) return { status: "pending", elapsed: 0 };
  const earliest = addBusinessDays(start, 2);
  const latest = addBusinessDays(start, 6);
  const end = ticket.processing_completed_at || now;
  let elapsed = 0;
  for (let day = 1; day <= 6; day++) {
    if (addBusinessDays(start, day) <= end) elapsed = day;
  }
  return {
    status: ticket.processing_completed_at
      ? "completed"
      : now >= latest
        ? "overdue"
        : now >= earliest
          ? "window"
          : "waiting",
    start,
    earliest,
    latest,
    elapsed,
  };
}

export function ticketShareText(ticket, portalUrl) {
  const usd = (cents) => `USD ${(cents / 100).toFixed(2)}`;
  const link = new URL(portalUrl);
  link.searchParams.set("ticket", ticket.id);
  return [
    `Solicitud Saldo Express: ${ticket.id}`,
    `Monto solicitado: ${usd(ticket.amount)}`,
    `Valor estimado: ${usd(ticket.estimate.net)}`,
    `Modalidad: ${ticket.amount > 50000 ? "Método internacional" : "Método Express"}`,
    ...(ticket.amount > 50000
      ? [
          "Plazo estimado: 2 a 6 días hábiles desde la confirmación del pago por el administrador (lunes a viernes, sin ajuste por feriados).",
        ]
      : []),
    "Detalles en el portal privado (requiere iniciar sesión):",
    link.toString(),
  ].join("\n");
}
