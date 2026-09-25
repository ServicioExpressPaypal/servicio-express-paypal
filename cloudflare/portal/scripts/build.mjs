import { mkdir, cp, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
for (const name of [
  "portal.css",
  "lucide.min.js",
  "lucide-LICENSE",
  "accounts.js",
]) {
  await copyFile(`../../_pilot/tickets/${name}`, `dist/${name}`);
}
await copyFile("../../calculator-core.js", "dist/calculator-core.js");
await copyFile("../../assets/logo-saldo-express-header.jpg", "dist/logo.jpg");
