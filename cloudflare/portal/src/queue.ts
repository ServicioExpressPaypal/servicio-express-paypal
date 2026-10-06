// Customer-facing turn queue. Tickets wait in creation order; the head ticket has
// a short window to be paid. When the window lapses and others are waiting, the
// ticket goes to the back. Administrators are never restricted by turns.
export const DEFAULT_TURN_WINDOW_MS = 120_000;
export const ADMIN_TICKET_ROOM = "__admin_ticket_updates__";
const MAX_BROADCAST = 40;

export type QueueEntry = {
  id: string;
  user_id: string;
  expires_at: number;
  queue_at: number;
  turn_started_at: number | null;
};
export type QueueResult = { queue: QueueEntry[]; changed: boolean };
export type LocalRoom = {
  id: string;
  send: (text: string) => void;
  setAlarm: (at: number) => Promise<void>;
};

export function turnWindowMs(env: Pick<Env, "TURN_WINDOW_SECONDS">) {
  const seconds = Number(env.TURN_WINDOW_SECONDS);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : DEFAULT_TURN_WINDOW_MS;
}
export function ticketRoomStub(
  env: Pick<Env, "TICKET_ROOM">,
  ticketId: string,
) {
  return env.TICKET_ROOM.get(env.TICKET_ROOM.idFromName(ticketId));
}
export async function activeQueue(
  db: D1Database,
  now: number,
): Promise<QueueEntry[]> {
  const rows = await db
    .prepare(
      "SELECT id,user_id,expires_at,queue_at,turn_started_at FROM tickets WHERE queue_at IS NOT NULL AND status NOT IN ('closed','cancelled') AND expires_at>? AND processing_started_at IS NULL AND processing_completed_at IS NULL ORDER BY queue_at,id",
    )
    .bind(now)
    .all<QueueEntry>();
  return rows.results;
}
// Idempotent: applies every turn rotation that is due, so it can run from a
// request, a Durable Object alarm or the cron without double-moving a ticket.
export async function advanceQueue(
  env: Pick<Env, "DB" | "TURN_WINDOW_SECONDS">,
  now = Date.now(),
  options: { restartAlone?: boolean } = {},
): Promise<QueueResult> {
  const window = turnWindowMs(env);
  let changed = false;
  let hint: number | null = null;
  for (let i = 0; i < 25; i++) {
    const queue = await activeQueue(env.DB, now);
    const head = queue[0];
    if (!head) return { queue, changed };
    if (head.turn_started_at == null) {
      await env.DB.prepare(
        "UPDATE tickets SET turn_started_at=? WHERE id=? AND turn_started_at IS NULL",
      )
        .bind(hint ?? now, head.id)
        .run();
      hint = null;
      changed = true;
      continue;
    }
    if (queue.length === 1) {
      // Nobody is waiting, so the turn does not lapse; it restarts when needed.
      if (head.turn_started_at + window <= now || options.restartAlone) {
        await env.DB.prepare(
          "UPDATE tickets SET turn_started_at=? WHERE id=? AND turn_started_at=?",
        )
          .bind(now, head.id, head.turn_started_at)
          .run();
        head.turn_started_at = now;
        changed = true;
      }
      return { queue, changed };
    }
    const expiry = head.turn_started_at + window;
    if (expiry > now) return { queue, changed };
    await env.DB.prepare(
      "UPDATE tickets SET queue_at=?,turn_started_at=NULL WHERE id=? AND turn_started_at=?",
    )
      .bind(expiry, head.id, head.turn_started_at)
      .run();
    hint = expiry;
    changed = true;
  }
  return { queue: await activeQueue(env.DB, now), changed };
}
export function queueInfo(
  env: Pick<Env, "TURN_WINDOW_SECONDS">,
  queue: QueueEntry[],
  ticketId: string,
  now = Date.now(),
) {
  const index = queue.findIndex((entry) => entry.id === ticketId);
  if (index < 0) return null;
  const head = queue[0];
  const waiting = queue.length > 1;
  return {
    position: index + 1,
    total: queue.length,
    ahead: index,
    isTurn: index === 0,
    turnExpiresAt:
      index === 0 && waiting && head.turn_started_at != null
        ? head.turn_started_at + turnWindowMs(env)
        : null,
    windowSeconds: Math.round(turnWindowMs(env) / 1000),
    serverNow: now,
  };
}
// Tells every affected ticket page to refresh and arms the alarm that will
// rotate the head ticket when its window ends.
export async function settleQueue(
  env: Pick<Env, "TICKET_ROOM" | "TURN_WINDOW_SECONDS">,
  result: QueueResult,
  options: { force?: boolean; extraIds?: string[]; local?: LocalRoom } = {},
) {
  const { queue } = result;
  const { local } = options;
  if (options.force || result.changed) {
    const ids = new Set([
      ...queue.slice(0, MAX_BROADCAST).map((entry) => entry.id),
      ...(options.extraIds ?? []),
    ]);
    const text = JSON.stringify({ type: "refresh" });
    await Promise.all([
      ...[...ids].map(async (id) => {
        if (local?.id === id) return local.send(text);
        await ticketRoomStub(env, id)
          .fetch("https://room/broadcast", { method: "POST", body: text })
          .catch(() => undefined);
      }),
      ticketRoomStub(env, ADMIN_TICKET_ROOM)
        .fetch("https://room/broadcast", { method: "POST", body: text })
        .catch(() => undefined),
    ]);
  }
  const head = queue[0];
  if (head && queue.length > 1 && head.turn_started_at != null) {
    const at =
      Math.min(head.turn_started_at + turnWindowMs(env), head.expires_at) + 50;
    if (local?.id === head.id) await local.setAlarm(at);
    else
      await ticketRoomStub(env, head.id)
        .fetch("https://room/arm", {
          method: "POST",
          body: JSON.stringify({ id: head.id, at }),
        })
        .catch(() => undefined);
  }
}
