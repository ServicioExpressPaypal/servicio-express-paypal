const MANAGUA_OFFSET = 6 * 60 * 60 * 1000;

// Preserve the local confirmation time; Nicaragua uses UTC-6 without DST.
export function addBusinessDays(timestamp, days) {
  const local = new Date(timestamp - MANAGUA_OFFSET);
  while (days > 0) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (![0, 6].includes(local.getUTCDay())) days--;
  }
  return local.getTime() + MANAGUA_OFFSET;
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
