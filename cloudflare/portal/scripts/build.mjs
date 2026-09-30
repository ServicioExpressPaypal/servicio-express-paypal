import { mkdir, cp, copyFile } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  stdin: {
    contents:
      'import QRCode from "qrcode"; export const toCanvas = QRCode.toCanvas;',
    resolveDir: process.cwd(),
  },
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/qrcode.js",
});
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
await copyFile("../../maintenance.css", "dist/maintenance.css");
for (const name of ["privacidad.html", "terminos.html", "legal.css"])
  await copyFile("../../" + name, "dist/" + name);
