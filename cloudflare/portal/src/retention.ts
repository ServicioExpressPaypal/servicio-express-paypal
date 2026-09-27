export async function purgeExpiredTicketData(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE expires_at<=? OR status IN ('closed','cancelled'))",
    ).bind(now),
    env.DB.prepare(
      "UPDATE tickets SET beneficiary_name='',bank_account='',bank='',data_erased_at=? WHERE data_erased_at IS NULL AND (expires_at<=? OR status IN ('closed','cancelled'))",
    ).bind(now, now),
  ]);
}
