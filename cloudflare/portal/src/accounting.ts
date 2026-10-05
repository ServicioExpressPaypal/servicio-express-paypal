// Admin accounting: profit per paid ticket and per day.
//
// A ticket counts on the day (America/Managua, UTC-6, no DST) the admin
// confirmed its payment. The profit of a ticket is the service commission
// (3% Express, 2% International) saved in its estimate; the PayPal and
// delivery costs are the estimates stored when the ticket was created, not
// the actual provider charges. Amounts are integer USD cents and no personal
// or bank data is read.
const MANAGUA_OFFSET = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  mode: string;
  amount: number;
  estimate: string;
  processing_started_at: number;
  processing_completed_at: number | null;
};
type Totals = {
  count: number;
  delivered: number;
  gross: number;
  paypal: number;
  delivery: number;
  profit: number;
  net: number;
};

export class AccountingError extends Error {}

const managuaDate = (timestamp: number) =>
  new Date(timestamp - MANAGUA_OFFSET).toISOString().slice(0, 10);
// First instant (UTC ms) of a Managua calendar day.
const dayStart = (date: string) =>
  Date.parse(date + "T00:00:00Z") + MANAGUA_OFFSET;

export function parseAccountingDate(value: string | null, now = Date.now()) {
  if (!value) return managuaDate(now);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(value + "T00:00:00Z")
    : NaN;
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new AccountingError("Fecha inválida. Usa el formato AAAA-MM-DD.");
  return value;
}

const empty = (): Totals => ({
  count: 0,
  delivered: 0,
  gross: 0,
  paypal: 0,
  delivery: 0,
  profit: 0,
  net: 0,
});

function entry(row: Row) {
  const estimate = JSON.parse(row.estimate) as {
    paypal: number;
    delivery: number;
    service: number;
    net: number;
  };
  return {
    id: row.id,
    mode: row.mode,
    paidAt: row.processing_started_at,
    deliveredAt: row.processing_completed_at,
    gross: row.amount,
    paypal: estimate.paypal,
    delivery: estimate.delivery,
    profit: estimate.service,
    net: estimate.net,
  };
}
function add(totals: Totals, item: ReturnType<typeof entry>) {
  totals.count++;
  if (item.deliveredAt) totals.delivered++;
  totals.gross += item.gross;
  totals.paypal += item.paypal;
  totals.delivery += item.delivery;
  totals.profit += item.profit;
  totals.net += item.net;
}

export async function accountingReport(env: Env, dateParam: string | null) {
  const date = parseAccountingDate(dateParam);
  const month = date.slice(0, 7);
  const monthStart = dayStart(month + "-01");
  const start = dayStart(date);
  const trailingStart = start - 13 * DAY;
  const from = Math.min(monthStart, trailingStart);
  const rows = await env.DB.prepare(
    "SELECT id,mode,amount,estimate,processing_started_at,processing_completed_at FROM tickets WHERE processing_started_at>=? AND processing_started_at<? AND status!='cancelled' ORDER BY processing_started_at,id LIMIT 5000",
  )
    .bind(from, start + DAY)
    .all<Row>();
  const day = { ...empty(), tickets: [] as ReturnType<typeof entry>[] };
  const monthTotals = empty();
  const perDay = new Map<string, Totals>();
  for (let i = 13; i >= 0; i--)
    perDay.set(managuaDate(start - i * DAY), empty());
  for (const row of rows.results) {
    const item = entry(row);
    const itemDate = managuaDate(item.paidAt);
    if (itemDate === date) {
      add(day, item);
      day.tickets.push(item);
    }
    if (itemDate.startsWith(month)) add(monthTotals, item);
    const bucket = perDay.get(itemDate);
    if (bucket) add(bucket, item);
  }
  return {
    date,
    timezone: "America/Managua",
    day,
    month: { label: month, ...monthTotals },
    days: [...perDay].map(([d, totals]) => ({ date: d, ...totals })),
    note: "Ganancia = comisión de servicio del ticket. Los costos de PayPal y de entrega son los estimados al crear el ticket, no los cargos reales de los proveedores.",
  };
}
