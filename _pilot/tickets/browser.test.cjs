const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { mkdir } = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const output = "/tmp/saldo-express-pilot";
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  const role = async (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const screen = async (name) =>
    page.screenshot({ path: output + "/" + name + ".png", fullPage: true });
  const responsive = async (label) => {
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        label + " overflow " + width,
      );
    }
  };
  const decision = async (label, reason, review = false) => {
    await role(label);
    if (review) await page.locator("[name=reviewed]").check();
    await page.getByLabel("Motivo de la decisión").fill(reason);
    await page.locator("#decision [type=submit]").click();
  };
  try {
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    assert.equal(
      await page
        .getByRole("button", { name: "Mis solicitudes", exact: true })
        .isDisabled(),
      true,
    );
    await responsive("registro");
    await screen("registro-desktop");
    await page
      .getByLabel("Correo electrónico", { exact: true })
      .fill("prueba@example.com");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill("demo-password-123");
    await role("Mostrar contraseña");
    assert.equal(await page.locator("#password").getAttribute("type"), "text");
    await role("Crear cuenta");
    assert.equal(await page.locator("input[type=password]").count(), 0);
    await role("Simular correo verificado");
    await page
      .getByLabel("Nombre completo", { exact: true })
      .fill("Persona de Prueba");
    await page
      .getByLabel("Número de cédula", { exact: true })
      .fill("000-000000-0000A");
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 500;
      c.height = 310;
      const x = c.getContext("2d");
      x.fillStyle = "#f0f2f4";
      x.fillRect(0, 0, 500, 310);
      x.fillStyle = "#26313b";
      x.font = "bold 26px Arial";
      x.fillText("DOCUMENTO FICTICIO", 40, 130);
      x.font = "18px Arial";
      x.fillText("Sin datos personales", 40, 170);
      return c.toDataURL().split(",")[1];
    });
    const fixture = {
      name: "cedula-ficticia.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    };
    await page
      .getByLabel("Frente de la cédula", { exact: true })
      .setInputFiles({
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      });
    await page.waitForFunction(() =>
      document
        .querySelector("[name=front]")
        .validationMessage.includes("válida"),
    );
    for (const side of ["Frente", "Reverso"])
      await page
        .getByLabel(side + " de la cédula", { exact: true })
        .setInputFiles(fixture);
    await page.locator("#preview-back").waitFor({ state: "visible" });
    await page.locator('select[name="source"]').selectOption("Salario");
    await page
      .getByLabel("Describe el origen de los fondos")
      .fill("Ingresos ficticios por trabajo asalariado.");
    await page
      .getByRole("button", { name: "términos y condiciones", exact: true })
      .click();
    assert.match(
      await page.locator(".legal").textContent(),
      /suspender o cerrar/,
    );
    await role("Cerrar");
    assert.equal(await page.locator("[name=terms]").isChecked(), false);
    for (const consent of ["declaration", "terms", "privacy"])
      await page.locator("[name=" + consent + "]").check();
    await responsive("KYC");
    await screen("kyc-desktop");
    await page.setViewportSize({ width: 390, height: 1000 });
    await screen("kyc-mobile");
    await role("Enviar a revisión");
    await page.getByRole("heading", { name: "Recibimos tus datos" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Mis solicitudes", exact: true })
        .isDisabled(),
      true,
    );
    await role("Administrador");
    await role("Revisar");
    await responsive("expediente");
    await screen("admin-expediente");
    await decision(
      "Pedir corrección",
      "Describe mejor la actividad de origen.",
    );
    await role("Cliente");
    assert.match(await page.locator("#main").textContent(), /Describe mejor/);
    for (const side of ["Frente", "Reverso"])
      await page
        .getByLabel(side + " de la cédula", { exact: true })
        .setInputFiles(fixture);
    for (const consent of ["declaration", "terms", "privacy"])
      await page.locator("[name=" + consent + "]").check();
    await role("Enviar a revisión");
    await page.getByRole("heading", { name: "Recibimos tus datos" }).waitFor();
    await role("Administrador");
    await decision(
      "Activar cuenta",
      "Identidad y origen revisados en la demo.",
      true,
    );
    await role("Cliente");
    await role("Mis solicitudes");
    await page.getByLabel("Monto en PayPal (USD)").fill("164");
    assert.match(
      await page.locator("#estimate-preview").textContent(),
      /145[.,]00/,
    );
    assert.equal(
      await page.locator(".cost-details").getAttribute("open"),
      null,
    );
    await page.getByText("Ver costos", { exact: false }).click();
    assert.equal(
      await page.locator(".cost-details .info-list").isVisible(),
      true,
    );
    assert.match(await page.locator(".cost-details").textContent(), /9[.,]16/);
    await page
      .getByLabel("Modalidad")
      .selectOption("international");
    await page.getByLabel("Monto en PayPal (USD)").fill("600");
    assert.match(
      await page.locator(".customer-estimate").textContent(),
      /546[.,]93/,
    );
    await page.getByText("Ver costos", { exact: false }).click();
    await page.getByLabel("Moneda de entrega").selectOption("USD");
    assert.equal(
      await page.locator(".cost-details .info-list").isVisible(),
      true,
    );
    await page.getByLabel("Modalidad").selectOption("express");
    assert.equal(
      await page.locator("#estimate-preview .form-error").count(),
      1,
    );
    await page.getByLabel("Monto en PayPal (USD)").fill("164");
    assert.equal(
      await page.locator(".cost-details").getAttribute("open"),
      null,
    );
    await page.getByLabel("Moneda de entrega").selectOption("USD");
    await screen("cliente-estimacion-desktop");
    await page.setViewportSize({ width: 390, height: 1000 });
    const submitBox = await page
      .getByRole("button", { name: "Crear solicitud", exact: true })
      .boundingBox();
    assert.ok(
      submitBox.y + submitBox.height < 900,
      "La acción principal debe quedar cerca del primer viewport móvil",
    );
    await screen("cliente-estimacion-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("[name=contact]").check();
    await role("Crear solicitud");
    assert.equal(await page.locator(".ticket-card").count(), 1);
    assert.match(
      await page.locator(".estimate-net").textContent(),
      /145[.,]00/,
    );
    await responsive("solicitudes-cliente");
    await screen("cliente-desktop");
    await page.setViewportSize({ width: 390, height: 1000 });
    await screen("cliente-mobile");
    await role("Administrador");
    await role("Solicitudes");
    assert.equal(await page.locator("#rows tr").count(), 6);
    await responsive("bandeja");
    await screen("admin-solicitudes");
    const id = await page.locator("#rows .ticket-id").first().textContent();
    await page.getByLabel("Buscar ticket o cliente").fill(id);
    await page.locator("#rows .ticket-id").click();
    await role("Iniciar revisión");
    await role("Preparar cotización");
    assert.equal(await page.locator("[name=fee]").inputValue(), "19.00");
    assert.equal(await page.locator("[name=received]").inputValue(), "145.00");
    await page.getByLabel("Comisión y costos totales (USD)").fill("16.40");
    assert.equal(await page.locator("[name=received]").inputValue(), "147.60");
    await role("Registrar cotización");
    await role("Preparar factura de ejemplo");
    await page
      .getByLabel("Concepto real de la operación")
      .fill("Operación de ejemplo para validar el flujo");
    await role("Crear vista previa");
    assert.match(
      await page.locator(".invoice-total").textContent(),
      /164[.,]00/,
    );
    await role("Cerrar");
    await page.getByLabel("Nota interna").fill("<img src=x onerror=alert(1)>");
    await role("Guardar nota");
    assert.equal(await page.locator(".timeline img").count(), 0);
    await role("Notificaciones");
    assert.equal(await page.locator(".alert-item").count(), 3);
    await role("Disponibilidad");
    await page.getByRole("switch", { name: "Solicitudes Express" }).uncheck();
    await page
      .getByRole("switch", { name: "Solicitudes internacionales" })
      .uncheck();
    await role("Cliente");
    await role("Mis solicitudes");
    assert.equal(
      await page.getByRole("button", { name: "Crear solicitud" }).isDisabled(),
      true,
    );
    await role("Administrador");
    await decision("Suspender cuenta", "Se requiere una revisión adicional.");
    await role("Cliente");
    assert.equal(
      await page
        .getByRole("button", { name: "Mis solicitudes", exact: true })
        .isDisabled(),
      true,
    );
    assert.match(
      await page.locator("#main").textContent(),
      /Se requiere una revisión adicional/,
    );
    await role("Administrador");
    await decision(
      "Reactivar cuenta",
      "Revisión completada correctamente.",
      true,
    );
    await decision("Cerrar cuenta", "Cierre solicitado por el titular.");
    await role("Cliente");
    assert.match(
      await page.locator("#main").textContent(),
      /Tu cuenta está cerrada/,
    );
    await role("Administrador");
    assert.match(
      await page.locator(".timeline").textContent(),
      /Cierre solicitado/,
    );
    await page.reload();
    assert.equal(await page.locator("#signup").count(), 1);
    assert.deepEqual(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
      { local: 0, session: 0 },
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      JSON.stringify({
        result: "OK",
        flow: "registro > correo > KYC > corrección > aprobación > ticket > cotización > suspensión > reactivación > cierre",
        widths: [360, 390, 768, 1440],
        externalRequests: 0,
        screenshots: output,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
