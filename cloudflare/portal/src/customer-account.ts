// SQL deletion is atomic. Legacy private files are retried separately if R2 is unavailable.
export async function eraseAccount(env: Env, userId: string, email: string) {
  const allowed = "EXISTS(SELECT 1 FROM document_deletions WHERE user_id=?)";
  const ownTickets = "SELECT id FROM tickets WHERE user_id=?";
  const statements = [
    env.DB.prepare(
      `INSERT INTO document_deletions(user_id,document_keys,created_at)
      SELECT user_id, json_array(json_extract(dossier,'$.front'),json_extract(dossier,'$.back')), ?
      FROM profiles WHERE user_id=? AND NOT EXISTS(
        SELECT 1 FROM tickets WHERE user_id=? AND (
          (processing_started_at IS NOT NULL AND processing_completed_at IS NULL AND status!='cancelled')
          OR (status='quoted' AND expires_at>?)
        )
      )`,
    ).bind(Date.now(), userId, userId, Date.now()),
    env.DB.prepare(
      `DELETE FROM audit_events WHERE ${allowed} AND
      (actor_id=? OR target_id=? OR target_id IN (${ownTickets}))`,
    ).bind(userId, userId, userId, userId),
    env.DB.prepare(
      `DELETE FROM ticket_messages WHERE ${allowed} AND
      (author_id=? OR ticket_id IN (${ownTickets}))`,
    ).bind(userId, userId, userId),
    env.DB.prepare(
      `DELETE FROM notifications WHERE ${allowed} AND ticket_id IN (${ownTickets})`,
    ).bind(userId, userId),
    env.DB.prepare(
      `DELETE FROM account_notices WHERE ${allowed} AND user_id=?`,
    ).bind(userId, userId),
    env.DB.prepare(`DELETE FROM tickets WHERE ${allowed} AND user_id=?`).bind(
      userId,
      userId,
    ),
    env.DB.prepare(
      `DELETE FROM verification WHERE ${allowed} AND (value=? OR identifier=? OR identifier=?)`,
    ).bind(userId, userId, userId, email),
    env.DB.prepare(
      `DELETE FROM request_limits WHERE ${allowed} AND key IN (?,?,?,?)`,
    ).bind(
      userId,
      `user:${userId}`,
      `kyc:${userId}`,
      `tickets:${userId}`,
      `admin-unlock:${userId}`,
    ),
    env.DB.prepare(
      `DELETE FROM user WHERE ${allowed} AND id=? RETURNING id`,
    ).bind(userId, userId),
  ];
  const results = await env.DB.batch(statements);
  return results[results.length - 1].results.length > 0;
}

export async function purgeDeletedDocuments(env: Env) {
  const jobs = await env.DB.prepare(
    "SELECT user_id,document_keys FROM document_deletions ORDER BY created_at LIMIT 20",
  ).all<{ user_id: string; document_keys: string }>();
  for (const job of jobs.results) {
    try {
      const keys = JSON.parse(job.document_keys).filter(
        (key: unknown) => typeof key === "string" && key.length,
      );
      if (keys.length) await env.DOCUMENTS.delete(keys);
      await env.DB.prepare("DELETE FROM document_deletions WHERE user_id=?")
        .bind(job.user_id)
        .run();
    } catch {
      console.error(
        JSON.stringify({ event: "account_document_cleanup_retry" }),
      );
    }
  }
}
