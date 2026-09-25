import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth.ts";
const db = new DatabaseSync(":memory:");
const options = authOptions(
  { DB: db, APP_URL: "http://localhost:8791" },
  { waitUntil() {} },
);
const migration = await getMigrations(options);
await writeFile(
  new URL("../migrations/0001_auth.sql", import.meta.url),
  await migration.compileMigrations(),
);
db.close();
