import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  chmod,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encryptLegacyData } from "../src/encryption.ts";

const exec = promisify(execFile);
const cwd = new URL("../", import.meta.url);
const dir = new URL(".wrangler/security/", cwd);
const secretFile = new URL("data-encryption.json", dir);
await mkdir(dir, { recursive: true, mode: 0o700 });
const action = process.argv[2];
if (action === "prepare") {
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
} else if (action === "encrypt-production") {
  if (process.argv[3] !== "saldo-express-portal")
    throw new Error("Explicit production target required");
  const env = JSON.parse(await readFile(secretFile, "utf8"));
  const temporary = await mkdtemp(new URL("sql-", dir).pathname);
  let sequence = 0;
  function prepare(sql) {
    let values = [];
    const statement = {
      bind(...args) {
        values = args;
        return statement;
      },
      async execute() {
        let i = 0;
        const quoted = sql.replace(/\?/g, () => {
          const value = values[i++];
          if (value === null) return "NULL";
          if (typeof value === "number" && Number.isFinite(value))
            return String(value);
          if (typeof value !== "string")
            throw new Error("Invalid SQL parameter");
          return "'" + value.replaceAll("'", "''") + "'";
        });
        if (i !== values.length) throw new Error("SQL parameter mismatch");
        const path = `${temporary}/${sequence++}.sql`;
        await writeFile(path, quoted, { mode: 0o600 });
        try {
          const { stdout } = await exec(
            process.execPath,
            [
              "node_modules/wrangler/bin/wrangler.js",
              "d1",
              "execute",
              "DB",
              "--remote",
              "--file",
              path,
              "--json",
            ],
            { cwd, maxBuffer: 8 * 1024 * 1024 },
          );
          const result = JSON.parse(stdout);
          if (!Array.isArray(result) || !result[0]?.success)
            throw new Error("Database operation failed");
          return result[0];
        } catch {
          throw new Error(
            "Encrypted migration failed; sensitive command output withheld",
          );
        } finally {
          await rm(path, { force: true });
        }
      },
      async all() {
        return statement.execute();
      },
      async run() {
        return statement.execute();
      },
    };
    return statement;
  }
  env.DB = { prepare };
  let total = 0;
  try {
    for (let n = 0; n < 100; n++) {
      const count = await encryptLegacyData(env);
      total += count;
      if (!count) {
        console.log(
          `Encrypted migration complete; ${total} records processed.`,
        );
        break;
      }
      if (n === 99) throw new Error("Migration batch limit reached");
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else
  throw new Error("Use prepare or encrypt-production saldo-express-portal");
