// Browser test for the customer panel. It starts the local preview (fictional
// data only) and drives it with Playwright; it is skipped when Playwright is
// not installed. Run with: npm run test:ui
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  /* Playwright is optional. */
}
const port = 8780 + (process.pid % 20);
const origin = `http://127.0.0.1:${port}`;
const password = "SoloPruebas-2026!";
const expressId = "SE-11111111-1111-4111-8111-111111111111";
const internationalId = "SE-22222222-2222-4222-8222-222222222222";

async function adminClient() {
  const jar = new Map();
  const send = async (path, body) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, data: await response.json() };
  };
  const login = await send("/api/auth/sign-in/email", {
    email: "admin@example.test",
    password,
  });
  assert.equal(login.status, 200);
  return send;
}

test(
  "customer panel keeps paid, delivered and cancelled certificates visible, live",
  { skip: !playwright && "Playwright is not installed", timeout: 120000 },
  async () => {
    const server = spawn(process.execPath, ["scripts/preview.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let browser;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("preview did not start")),
          60000,
        );
        server.on("exit", () => reject(new Error("preview exited")));
        server.stdout.on("data", (chunk) => {
          if (String(chunk).includes("Vista local")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      browser = await playwright.chromium.launch({
        executablePath:
          process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium",
      });
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 900 } })
      ).newPage();
      await page.goto(origin + "/");
      await page.fill("input[type=email]", "cliente@example.test");
      await page.fill("input[type=password]", password);
      await page.click("button[type=submit]");
      await page.waitForSelector(".gift-catalog");
      const active = () => page.locator(".customer-tickets > .ticket-list");
      const recent = () => page.locator("#recent-list");
      // Both seeded tickets are active; nothing finished yet (empty state).
      assert.equal(await active().locator(".ticket-row").count(), 2);
      assert.match(
        await recent().innerText(),
        /Todavía no tienes certificados pagados, enviados o cancelados/,
      );
      // Mobile: no horizontal overflow and nothing clipped.
      await page.setViewportSize({ width: 375, height: 800 });
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          375,
      );
      await page.setViewportSize({ width: 1000, height: 900 });

      const admin = await adminClient();
      const version = async (id) =>
        (await admin("/api/admin/tickets/" + id)).data.version;
      // Admin confirms payment: the ticket stays under active requests but
      // shows its new status without reloading.
      assert.equal(
        (
          await admin(`/api/admin/tickets/${expressId}/processing`, {
            action: "start",
            version: await version(expressId),
          })
        ).status,
        200,
      );
      await page.waitForFunction(
        (id) =>
          [
            ...document.querySelectorAll(
              ".customer-tickets > .ticket-list .ticket-row",
            ),
          ].some(
            (row) =>
              row.innerText.includes(id) &&
              row.innerText.includes("Pago confirmado"),
          ),
        expressId,
        { timeout: 10000 },
      );
      // Admin confirms delivery: it moves to "Certificados recientes".
      assert.equal(
        (
          await admin(`/api/admin/tickets/${expressId}/processing`, {
            action: "complete",
            version: await version(expressId),
          })
        ).status,
        200,
      );
      await page.waitForFunction(
        (id) => document.querySelector("#recent-list")?.innerText.includes(id),
        expressId,
        { timeout: 10000 },
      );
      assert.match(await recent().innerText(), /Enviado al beneficiario/);
      assert.equal(await active().locator(".ticket-row").count(), 1);
      // The erased destination never comes back.
      const text = await recent().innerText();
      assert.doesNotMatch(text, /000123456789|Familiar de Prueba|LAFISE/);
      // Cancelled certificates also show up, with the right status.
      assert.equal(
        (
          await admin(`/api/admin/tickets/${internationalId}`, {
            action: "cancelled",
            version: await version(internationalId),
          })
        ).status,
        200,
      );
      await page.waitForFunction(
        (id) => document.querySelector("#recent-list")?.innerText.includes(id),
        internationalId,
        { timeout: 10000 },
      );
      assert.match(await recent().innerText(), /Cancelada/);
      assert.match(
        await active().innerText(),
        /No tienes solicitudes vigentes/,
      );
      // The full history lists everything with its status.
      await page.click("#all-history");
      await page.waitForSelector("#history-search");
      const history = await page.locator("main").innerText();
      assert.match(history, /Enviado al beneficiario/);
      assert.match(history, /Cancelada/);
      assert.match(history, /2 solicitudes/);
    } finally {
      await browser?.close();
      server.kill();
    }
  },
);
