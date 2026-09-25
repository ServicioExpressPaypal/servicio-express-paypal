const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Keep analytics and advertising out of this calculator regression test.
    await page.route(/^https?:/, (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../../index.html")).href,
    );
    await page.locator("#calcAmount").fill("164");
    assert.equal(await page.locator("#netAmount").textContent(), "$145.00");
    await page.locator("#serviceMode").selectOption("international");
    await page.locator("#calcAmount").fill("600");
    assert.equal(await page.locator("#netAmount").textContent(), "$546.93");
    await page.locator("#poBalance").fill("200");
    assert.equal(await page.locator("#poOperatorFee").textContent(), "$7.00");
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../../kyc.html")).href,
    );
    assert.deepEqual(errors, []);
    console.log(
      "OK: public calculator, international mode, ATM USD 7, and paused KYC page",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
