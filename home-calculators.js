(function (root) {
  "use strict";

  const config = {
    paypalRate: 0.054,
    paypalFixed: 0.3,
    payoneerFixed: 3.15,
    payoneerRate: 0.01855,
    atmFee: 7,
    atmStep: 20,
  };

  function validAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function paypalReceive(value) {
    const net = validAmount(value);
    if (!net) return { net: 0, gross: 0, fee: 0 };
    const gross = (net + config.paypalFixed) / (1 - config.paypalRate);
    return { net, gross, fee: gross - net };
  }

  function paypalSend(value) {
    const gross = validAmount(value);
    if (!gross) return { gross: 0, fee: 0, net: 0 };
    const fee = gross * config.paypalRate + config.paypalFixed;
    return { gross, fee, net: Math.max(gross - fee, 0) };
  }

  function payoneerAtm(value) {
    const balance = validAmount(value);
    if (!balance)
      return { balance: 0, fee: 0, atm: 0, withdrawal: 0, remaining: 0 };
    const fee = config.payoneerFixed + config.payoneerRate * balance;
    const raw = balance - fee - config.atmFee;
    const withdrawal =
      raw > 0 ? Math.floor(raw / config.atmStep) * config.atmStep : 0;
    const remaining = Math.max(balance - withdrawal - fee - config.atmFee, 0);
    return {
      balance,
      fee,
      atm: config.atmFee,
      withdrawal,
      remaining,
    };
  }

  const api = { config, paypalReceive, paypalSend, payoneerAtm };
  root.HomeCalculators = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
