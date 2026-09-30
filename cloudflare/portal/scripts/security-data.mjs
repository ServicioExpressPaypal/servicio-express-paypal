import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const cwd = new URL("../", import.meta.url);
const action = process.argv[2];
if (action === "prepare") {
  const dir = new URL(".wrangler/security/", cwd);
  const secretFile = new URL("data-encryption.json", dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  try {
    await writeFile(
      secretFile,
      JSON.stringify({
        DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      }),
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await chmod(secretFile, 0o600);
  console.log(
    "Encryption key prepared in protected, ignored file. Existing key preserved.",
  );
} else if (action === "verify-production") {
  if (process.argv[3] !== "saldo-express-portal")
    throw new Error("Explicit production target required");
  // Migration runs inside the Worker cron: only aggregate counts leave D1 here.
  const sql = `SELECT
    (SELECT count(*) FROM profiles WHERE full_name!='' AND full_name NOT LIKE 'enc:v1:%') AS plaintext_names,
    (SELECT count(*) FROM profiles WHERE COALESCE(json_extract(dossier,'$.phone'),'')!='' AND json_extract(dossier,'$.phone') NOT LIKE 'enc:v1:%') AS plaintext_phones,
    (SELECT count(*) FROM tickets WHERE beneficiary_name!='' AND beneficiary_name NOT LIKE 'enc:v1:%') AS plaintext_beneficiaries,
    (SELECT count(*) FROM tickets WHERE bank_account!='' AND bank_account NOT LIKE 'enc:v1:%') AS plaintext_accounts,
    (SELECT count(*) FROM ticket_messages WHERE body!='' AND body NOT LIKE 'enc:v1:%') AS plaintext_messages`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      sql,
      "--json",
    ],
    { cwd, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  const counts = result[0]?.results?.[0];
  if (!result[0]?.success || !counts || Object.keys(counts).length !== 5)
    throw new Error("Verification unavailable");
  console.log(JSON.stringify(counts));
  if (Object.values(counts).some((count) => count !== 0)) {
    console.error(
      "Legacy data pending. Wait for the next Worker cron and verify again before opening registration.",
    );
    process.exitCode = 1;
  }
} else throw new Error("Use prepare or verify-production saldo-express-portal");
