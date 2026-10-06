// Browser tests use an isolated local preview with fictional data only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";

let port = 8780 + (process.pid % 20);
let origin = `http://127.0.0.1:${port}`;
const password = "SoloPruebas-2026!";
const expressId = "SE-11111111-1111-4111-8111-111111111111";
const internationalId = "SE-22222222-2222-4222-8222-222222222222";

function launchBrowser() {
  return chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
      : {},
  );
}

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
  { timeout: 120000 },
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
      browser = await launchBrowser();
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 900 } })
      ).newPage();
      await page.goto(origin + "/");
      await page.fill("input[type=email]", "cliente@example.test");
      await page.fill("input[type=password]", password);
      await page.click("button[type=submit]");
      await page.waitForSelector(".gift-catalog");
      const themeToggle = page.locator("#theme-toggle");
      assert.equal(await themeToggle.getAttribute("role"), "switch");
      await themeToggle.click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("saldo-express-theme")),
        "dark",
      );
      await page.reload();
      await page.waitForSelector(".gift-catalog");
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      await page.locator("#theme-toggle").click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      const active = () => page.locator(".customer-tickets > .ticket-list");
      const recent = () => page.locator("#recent-list");
      // Both seeded tickets are active; nothing finished yet (empty state).
      assert.equal(await active().locator(".ticket-row").count(), 2);
      assert.match(
        await recent().innerText(),
        /Todavía no tienes certificados pagados, enviados o cancelados/,
      );
      await page.locator(`[data-ticket="${expressId}"]`).click();
      await page.waitForSelector("#message-form");
      await page.fill(
        "#ticket-message",
        "Consulta https://example.com/cliente.",
      );
      await page.click("#message-form button[type=submit]");
      await page.waitForSelector(
        '.chat-message-link[href="https://example.com/cliente"]',
      );
      const admin = await adminClient();
      assert.equal(
        (
          await admin(`/api/admin/tickets/${expressId}/messages`, {
            message: "Respuesta en www.example.com/admin",
          })
        ).status,
        201,
      );
      await page.waitForSelector(
        '.chat-message-link[href="https://www.example.com/admin"]',
      );
      const links = page.locator(".chat-message-link");
      assert.equal(await links.count(), 2);
      for (let index = 0; index < 2; index++) {
        assert.equal(await links.nth(index).getAttribute("target"), "_blank");
        assert.equal(
          await links.nth(index).getAttribute("rel"),
          "noopener noreferrer",
        );
      }
      await page.click("#back");
      await page.waitForSelector(".gift-catalog");
      // Mobile: no horizontal overflow and nothing clipped.
      await page.setViewportSize({ width: 375, height: 800 });
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          375,
      );
      await page.setViewportSize({ width: 1000, height: 900 });

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
      // Admin confirms delivery immediately after the first live refresh. The
      // backup check catches it even if it lands while sockets reconnect.
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

test(
  "admin accounting panel shows profit per ticket and the day summary",
  { timeout: 120000 },
  async () => {
    port += 20;
    origin = `http://127.0.0.1:${port}`;
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
      browser = await launchBrowser();
      const context = await browser.newContext({
        viewport: { width: 1000, height: 900 },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      await page.goto(origin + "/");
      await page.fill("input[type=email]", "admin@example.test");
      await page.fill("input[type=password]", password);
      await page.click("button[type=submit]");
      await page.getByRole("button", { name: "Contabilidad" }).click();
      await page.waitForSelector(".accounting-summary");
      // Empty state before any payment is confirmed.
      assert.match(
        await page.locator("main").innerText(),
        /No hay pagos confirmados este día/,
      );
      assert.match(
        await page.locator(".accounting-profit").innerText(),
        /USD\s0\.00/,
      );
      // Confirming payment adds the ticket to today's accounting.
      const admin = await adminClient();
      const version = (await admin("/api/admin/tickets/" + expressId)).data
        .version;
      assert.equal(
        (
          await admin(`/api/admin/tickets/${expressId}/processing`, {
            action: "start",
            version,
          })
        ).status,
        200,
      );
      await page.click("#accounting-today");
      await page.waitForSelector("#accounting-csv", { timeout: 10000 });
      // USD 164.00 Express: service commission 3% = USD 4.92.
      assert.match(
        await page.locator(".accounting-profit").innerText(),
        /USD\s4\.92/,
      );
      const row = page.locator(".accounting-table tbody tr").first(); // first table: today's tickets
      assert.match(await row.innerText(), /Express/);
      assert.match(await row.innerText(), /USD\s164\.00/);
      assert.match(await row.innerText(), /USD\s4\.92/);
      assert.match(await row.innerText(), /Pago confirmado/);
      // Stable column widths keep the reference, amounts and status separated.
      const columnWidths = await page
        .locator(".accounting-tickets thead th")
        .evaluateAll((cells) =>
          cells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
        );
      assert.ok(columnWidths[1] >= 220);
      const amountWidths = columnWidths.slice(3, 7);
      assert.ok(amountWidths.every((width) => width >= 108));
      assert.ok(Math.max(...amountWidths) - Math.min(...amountWidths) <= 1);
      assert.ok(columnWidths[7] >= 140);
      assert.ok(
        await page
          .locator(".accounting-tickets tbody td.num")
          .evaluateAll((cells) =>
            cells.every((cell) => getComputedStyle(cell).textAlign === "right"),
          ),
      );
      // No beneficiary or bank data in the accounting view.
      assert.doesNotMatch(
        await page.locator("main").innerText(),
        /Familiar de Prueba|000123456789|LAFISE/,
      );
      // CSV download for the accountant.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#accounting-csv"),
      ]);
      const { readFile } = await import("node:fs/promises");
      const csv = await readFile(await download.path(), "utf8");
      assert.match(csv, new RegExp(expressId));
      assert.match(csv, /,4\.92,/);
      // Mobile: summary stacks and nothing overflows the page.
      await page.setViewportSize({ width: 375, height: 800 });
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          375,
      );
    } finally {
      await browser?.close();
      server.kill();
    }
  },
);

test(
  "password recovery tells the user the link was sent, from login and from settings",
  { timeout: 120000 },
  async () => {
    port += 20;
    origin = `http://127.0.0.1:${port}`;
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
      browser = await launchBrowser();
      const page = await (
        await browser.newContext({ viewport: { width: 375, height: 800 } })
      ).newPage();
      // From the login screen: the form is replaced by a visible confirmation.
      await page.goto(origin + "/");
      await page.click("#recover");
      await page.fill("input[type=email]", "cliente@example.test");
      await page.click("#auth button[type=submit]");
      await page.waitForSelector(".recover-sent", { timeout: 10000 });
      const sent = await page.locator("main").innerText();
      assert.match(sent, /Revisa tu correo/);
      assert.match(sent, /Te enviamos un enlace de recuperación/);
      assert.match(sent, /cliente@example\.test/);
      assert.match(sent, /vence en 1 hora/);
      assert.match(sent, /spam/);
      assert.equal(await page.locator("input[type=email]").count(), 0);
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          375,
      );
      await page.click("#recover-back");
      await page.waitForSelector("#auth input[type=password]");
      // From Settings (signed in): the dialog turns into the confirmation.
      await page.fill("input[type=email]", "cliente@example.test");
      await page.fill("input[type=password]", password);
      await page.click("#auth button[type=submit]");
      await page.waitForSelector(".gift-catalog");
      await page.getByRole("button", { name: "Ajustes" }).click();
      await page.click("#reset-password");
      await page.click("#password-email button[type=submit]");
      await page.waitForSelector("#dialog .recover-sent", { timeout: 10000 });
      const dialog = await page.locator("#dialog").innerText();
      assert.match(dialog, /Te enviamos un enlace de recuperación/);
      assert.match(dialog, /cliente@example\.test/);
      await page.click("#recover-done");
      assert.equal(await page.locator("#dialog[open]").count(), 0);
    } finally {
      await browser?.close();
      server.kill();
    }
  },
);

test(
  "admin creates the temporary PIN before the dashboard can open",
  { timeout: 120000 },
  async () => {
    port += 20;
    origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ["scripts/preview.mjs"], {
      env: {
        ...process.env,
        PORT: String(port),
        PREVIEW_ADMIN_SECURITY: "pin",
      },
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
      browser = await launchBrowser();
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 900 } })
      ).newPage();
      await page.goto(origin + "/");
      await page.fill("input[type=email]", "admin@example.test");
      await page.fill("input[type=password]", password);
      await page.click("#auth button[type=submit]");
      await page
        .getByRole("heading", {
          name: "Crea tu PIN administrativo",
        })
        .waitFor();
      assert.equal(await page.locator(".admin-dashboard").count(), 0);
      await page.fill('input[name="password"]', password);
      await page.fill('input[name="pin"]', "482731");
      await page.fill('input[name="confirmation"]', "482731");
      await page.click("#pin-setup button[type=submit]");
      await page.getByRole("heading", { name: "Resumen" }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Usuarios" }).count());
    } finally {
      await browser?.close();
      server.kill();
    }
  },
);
