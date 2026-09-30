type EncryptionEnv = { DATA_ENCRYPTION_KEY: string };
const prefix = "enc:v1:";
const encoder = new TextEncoder();

function decode(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function encryptionKey(env: EncryptionEnv) {
  const bytes = decode(env.DATA_ENCRYPTION_KEY || "");
  if (bytes.length !== 32) throw new Error("Data encryption unavailable");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptField(
  env: EncryptionEnv,
  value: string,
  context: string,
) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await encryptionKey(env),
    encoder.encode(value),
  );
  const bytes = new Uint8Array(iv.length + ciphertext.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(ciphertext), iv.length);
  return prefix + btoa(String.fromCharCode(...bytes));
}

export async function decryptField(
  env: EncryptionEnv,
  value: string,
  context: string,
) {
  if (!value) return "";
  // Legacy rows remain readable while the bounded migration encrypts them.
  if (!value.startsWith(prefix)) {
    if (value.startsWith("enc:")) throw new Error("Unknown ciphertext version");
    return value;
  }
  const bytes = decode(value.slice(prefix.length));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes.slice(0, 12),
      additionalData: encoder.encode(context),
    },
    await encryptionKey(env),
    bytes.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

export async function profileFields(
  env: EncryptionEnv,
  id: string,
  name: string,
  dossier: string | null,
  encrypt = false,
) {
  const transform = encrypt ? encryptField : decryptField;
  const data = dossier ? JSON.parse(dossier) : null;
  if (data?.phone)
    data.phone = await transform(env, data.phone, `profile:${id}:phone`);
  return {
    full_name: await transform(env, name, `profile:${id}:name`),
    dossier: data ? JSON.stringify(data) : null,
  };
}

export async function ticketFields<
  T extends { id: string; beneficiary_name: string; bank_account: string },
>(env: EncryptionEnv, ticket: T, encrypt = false): Promise<T> {
  const transform = encrypt ? encryptField : decryptField;
  return {
    ...ticket,
    beneficiary_name: await transform(
      env,
      ticket.beneficiary_name,
      `ticket:${ticket.id}:beneficiary`,
    ),
    bank_account: await transform(
      env,
      ticket.bank_account,
      `ticket:${ticket.id}:account`,
    ),
  };
}

// Version checks prevent the migration from restoring expired or edited data.
export async function encryptLegacyData(env: Env) {
  const profiles = await env.DB.prepare(
    "SELECT user_id,full_name,dossier,version FROM profiles WHERE (full_name!='' AND full_name NOT LIKE 'enc:v1:%') OR (COALESCE(json_extract(dossier,'$.phone'),'')!='' AND json_extract(dossier,'$.phone') NOT LIKE 'enc:v1:%') LIMIT 50",
  ).all<{
    user_id: string;
    full_name: string;
    dossier: string | null;
    version: number;
  }>();
  for (const row of profiles.results) {
    const plain = await profileFields(
      env,
      row.user_id,
      row.full_name,
      row.dossier,
    );
    const secured = await profileFields(
      env,
      row.user_id,
      plain.full_name,
      plain.dossier,
      true,
    );
    await env.DB.prepare(
      "UPDATE profiles SET full_name=?,dossier=? WHERE user_id=? AND version=? AND full_name=? AND dossier IS ?",
    )
      .bind(
        secured.full_name,
        secured.dossier,
        row.user_id,
        row.version,
        row.full_name,
        row.dossier,
      )
      .run();
  }
  const tickets = await env.DB.prepare(
    "SELECT id,beneficiary_name,bank_account,version FROM tickets WHERE data_erased_at IS NULL AND ((beneficiary_name!='' AND beneficiary_name NOT LIKE 'enc:v1:%') OR (bank_account!='' AND bank_account NOT LIKE 'enc:v1:%')) LIMIT 50",
  ).all<{
    id: string;
    beneficiary_name: string;
    bank_account: string;
    version: number;
  }>();
  for (const row of tickets.results) {
    const secured = await ticketFields(env, await ticketFields(env, row), true);
    await env.DB.prepare(
      "UPDATE tickets SET beneficiary_name=?,bank_account=? WHERE id=? AND version=? AND beneficiary_name=? AND bank_account=? AND data_erased_at IS NULL",
    )
      .bind(
        secured.beneficiary_name,
        secured.bank_account,
        row.id,
        row.version,
        row.beneficiary_name,
        row.bank_account,
      )
      .run();
  }
  const messages = await env.DB.prepare(
    "SELECT id,body FROM ticket_messages WHERE body!='' AND body NOT LIKE 'enc:v1:%' LIMIT 50",
  ).all<{ id: string; body: string }>();
  for (const row of messages.results) {
    const body = await encryptField(env, row.body, `message:${row.id}`);
    await env.DB.prepare(
      "UPDATE ticket_messages SET body=? WHERE id=? AND body=?",
    )
      .bind(body, row.id, row.body)
      .run();
  }
  return (
    profiles.results.length + tickets.results.length + messages.results.length
  );
}
