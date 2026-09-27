(() => {
  "use strict";

  const calculators = window.HomeCalculators;
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number.isFinite(value) ? value : 0);
  const value = (id) =>
    Number.parseFloat(document.querySelector(id).value) || 0;
  const show = (id, amount) => {
    document.querySelector(id).textContent = money(amount);
  };

  function updatePaypalReceive() {
    const result = calculators.paypalReceive(value("#paypal-receive"));
    show("#paypal-gross", result.gross);
    show("#paypal-receive-fee", result.fee);
  }

  function updatePaypalSend() {
    const result = calculators.paypalSend(value("#paypal-send"));
    show("#paypal-send-fee", result.fee);
    show("#paypal-net", result.net);
  }

  function updatePayoneer() {
    const result = calculators.payoneerAtm(value("#payoneer-balance"));
    show("#payoneer-fee", result.fee);
    show("#atm-fee", result.atm);
    show("#atm-withdrawal", result.withdrawal);
    show("#payoneer-remaining", result.remaining);
  }

  document
    .querySelector("#paypal-receive")
    .addEventListener("input", updatePaypalReceive);
  document
    .querySelector("#paypal-send")
    .addEventListener("input", updatePaypalSend);
  document
    .querySelector("#payoneer-balance")
    .addEventListener("input", updatePayoneer);

  updatePaypalReceive();
  updatePaypalSend();
  updatePayoneer();
})();
