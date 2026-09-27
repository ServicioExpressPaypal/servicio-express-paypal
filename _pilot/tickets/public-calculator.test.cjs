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
    await page.locator("#paypal-receive").fill("100");
    assert.equal(await page.locator("#paypal-gross").textContent(), "$106.03");
    assert.equal(
      await page.locator("#paypal-receive-fee").textContent(),
      "$6.03",
    );
    await page.locator("#paypal-send").fill("100");
    assert.equal(await page.locator("#paypal-send-fee").textContent(), "$5.70");
    assert.equal(await page.locator("#paypal-net").textContent(), "$94.30");
    await page.locator("#payoneer-balance").fill("200");
    assert.equal(await page.locator("#payoneer-fee").textContent(), "$6.86");
    assert.equal(await page.locator("#atm-fee").textContent(), "$7.00");
    assert.equal(
      await page.locator("#atm-withdrawal").textContent(),
      "$180.00",
    );
    assert.equal(
      await page.locator("#payoneer-remaining").textContent(),
      "$6.14",
    );
    assert.equal(await page.locator("#calcAmount").count(), 0);
    assert.equal(await page.locator("#serviceMode").count(), 0);
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../../kyc.html")).href,
    );
    assert.deepEqual(errors, []);
    console.log(
      "OK: informational PayPal and Payoneer calculators, ATM USD 7, and paused KYC page",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
