(function (root) {
  "use strict";
  // Shared assumptions from the site's calculator; not live provider tariffs.
  const siteConfig = {
    projectName: "Saldo Express Nicaragua",
    whatsappNumber: "50586199889",
    paypalPercentFee: 0.054,
    paypalFixedFee: 0.3,
    atmRate: 0.03,
    atmWithdrawalFee: 10.45,
    wiseFixedFee: 7.41,
    wisePercent: 0.0016,
    serviceModes: {
      express: {
        label: "Escenario express",
        rate: 0.03,
        feeModel: "atm",
        deliveryLabel: "Procesamiento estimado",
        minAmount: 25,
        maxAmount: 500,
        deliveryTime: "Rango de referencia: $25 a $500",
      },
      international: {
        label: "Escenario internacional",
        rate: 0.02,
        feeModel: "wise",
        deliveryLabel: "Costo internacional estimado",
        minAmount: 500.01,
        maxAmount: 3000,
        deliveryTime: "Rango de referencia: más de $500 a $3,000",
      },
    },
  };
  function deliveryFee(mode, amount) {
    return mode.feeModel === "wise"
      ? siteConfig.wiseFixedFee + amount * siteConfig.wisePercent
      : Math.min(amount * siteConfig.atmRate, siteConfig.atmWithdrawalFee);
  }
  function computeFees(mode, gross) {
    const paypal =
      gross * siteConfig.paypalPercentFee + siteConfig.paypalFixedFee;
    const delivery = deliveryFee(mode, gross);
    const service = gross * mode.rate;
    const total = paypal + delivery + service;
    return {
      paypal,
      delivery,
      service,
      total,
      net: Math.max(0, gross - total),
    };
  }
  function reverseGross(mode, desiredNet) {
    if (!Number.isFinite(desiredNet) || desiredNet <= 0) return null;
    const p = siteConfig.paypalPercentFee,
      s = mode.rate,
      fixed = siteConfig.paypalFixedFee;
    if (mode.feeModel === "wise") {
      const denominator = 1 - p - siteConfig.wisePercent - s;
      return denominator > 0
        ? (desiredNet + fixed + siteConfig.wiseFixedFee) / denominator
        : null;
    }
    const denominator = 1 - p - s - siteConfig.atmRate;
    if (denominator > 0) {
      const gross = (desiredNet + fixed) / denominator;
      if (gross * siteConfig.atmRate <= siteConfig.atmWithdrawalFee)
        return gross;
    }
    const capped = 1 - p - s;
    return capped > 0
      ? (desiredNet + fixed + siteConfig.atmWithdrawalFee) / capped
      : null;
  }
  function estimate(amountCents, modeKey) {
    const mode = siteConfig.serviceModes[modeKey];
    if (
      !mode ||
      !Number.isSafeInteger(amountCents) ||
      amountCents < Math.round(mode.minAmount * 100) ||
      amountCents > Math.round(mode.maxAmount * 100)
    )
      throw new Error(
        mode ? mode.deliveryTime : "Selecciona una modalidad válida.",
      );
    const raw = computeFees(mode, amountCents / 100);
    const paypal = Math.round(raw.paypal * 100),
      delivery = Math.round(raw.delivery * 100),
      service = Math.round(raw.service * 100);
    // Round components first so the saved breakdown always adds up in cents.
    const total = paypal + delivery + service;
    return {
      version: "site-2026-09-23",
      amount: amountCents,
      mode: modeKey,
      paypal,
      delivery,
      service,
      total,
      net: amountCents - total,
      currency: "USD",
    };
  }
  const api = { siteConfig, deliveryFee, computeFees, reverseGross, estimate };
  root.SaldoCalculator = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
