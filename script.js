const siteConfig = {
  businessName: "Servicio Express Saldo PayPal Nicaragua",
  whatsappNumber: "50586199889",
  facebookUrl: "https://www.facebook.com/profile.php?id=61590018872357",
  defaultMessage: "Hola, vi su página web y quiero cambiar saldo PayPal.",
  paypalPercentFee: 0.054, // PayPal estandar internacional: 5.4% sobre el monto
  paypalFixedFee: 0.30, // PayPal estandar internacional: $0.30 fijo por transaccion
  atmRate: 0.03, // costo por retiro de tarjeta, repartido entre los clientes
  atmWithdrawalFee: 10.45, // costo real de un retiro; tope para que nadie pague de mas
  wiseFixedFee: 7.41, // costo fijo de Wise para el envio internacional
  wisePercent: 0.0016, // 0.16% sobre el monto; no se cobra la comision del banco del cliente
  serviceModes: {
    express: {
      label: "Servicio express",
      rate: 0.03,
      feeModel: "atm",
      deliveryLabel: "Comisión por procesamiento",
      minAmount: 50,
      maxAmount: 500,
      deliveryTime: "menos de 24 horas",
    },
    international: {
      label: "Transferencia internacional",
      rate: 0.02,
      feeModel: "wise",
      deliveryLabel: "Costo de envío internacional",
      minAmount: 500.01,
      maxAmount: 3000,
      deliveryTime: "2 a 6 días hábiles",
    },
  },
};

const whatsappBase = `https://wa.me/${siteConfig.whatsappNumber}`;
let latestCalculation = null;

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? value : 0);
}

function parseMoney(value) {
  const numeric = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatRate(rate) {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function getMode() {
  const select = document.querySelector("#serviceMode");
  return siteConfig.serviceModes[select && select.value] || siteConfig.serviceModes.express;
}

// Resuelve el monto a enviar por PayPal para netear `desiredNet` con la modalidad dada.
function reverseGross(mode, desiredNet) {
  if (!Number.isFinite(desiredNet) || desiredNet <= 0) return null;
  const p = siteConfig.paypalPercentFee;
  const ppFixed = siteConfig.paypalFixedFee;
  const s = mode.rate;

  if (mode.feeModel === "wise") {
    const fixed = ppFixed + siteConfig.wiseFixedFee;
    const denom = 1 - p - siteConfig.wisePercent - s;
    if (denom <= 0) return null;
    return (desiredNet + fixed) / denom;
  }

  // atm: prueba caso sin tope; si excede, usa el caso con tope fijo.
  const noCapDenom = 1 - p - s - siteConfig.atmRate;
  if (noCapDenom > 0) {
    const noCapGross = (desiredNet + ppFixed) / noCapDenom;
    if (noCapGross * siteConfig.atmRate <= siteConfig.atmWithdrawalFee) {
      return noCapGross;
    }
  }
  const capDenom = 1 - p - s;
  if (capDenom <= 0) return null;
  return (desiredNet + ppFixed + siteConfig.atmWithdrawalFee) / capDenom;
}

function deliveryFee(mode, amount) {
  if (mode.feeModel === "wise") {
    return siteConfig.wiseFixedFee + amount * siteConfig.wisePercent;
  }
  return Math.min(amount * siteConfig.atmRate, siteConfig.atmWithdrawalFee);
}

function setActionLinks() {
  document.querySelectorAll("[data-whatsapp]").forEach((link) => {
    const message = link.dataset.whatsappMessage || siteConfig.defaultMessage;
    const whatsappUrl = `${whatsappBase}?text=${encodeURIComponent(message)}`;
    link.href = whatsappUrl;
    link.target = "_blank";
    link.rel = "noopener";
  });

  document.querySelectorAll("[data-facebook]").forEach((link) => {
    link.href = siteConfig.facebookUrl;
    link.target = "_blank";
    link.rel = "noopener";
  });
}

function getCalcDirection() {
  const select = document.querySelector("#calcDirection");
  return select && select.value === "reverse" ? "reverse" : "forward";
}

function computeFees(mode, gross) {
  const paypal = gross * siteConfig.paypalPercentFee + siteConfig.paypalFixedFee;
  const delivery = deliveryFee(mode, gross);
  const service = gross * mode.rate;
  const total = paypal + delivery + service;
  const net = Math.max(0, gross - total);
  return { paypal, delivery, service, total, net };
}

function renderQuickQuoteTables() {
  document.querySelectorAll("[data-quote-table]").forEach((tableBody) => {
    const mode = siteConfig.serviceModes[tableBody.dataset.quoteTable];
    if (!mode) return;

    tableBody.querySelectorAll("[data-amount]").forEach((row) => {
      const amount = Number.parseFloat(row.dataset.amount);
      const netCell = row.querySelector("[data-quote-net]");
      if (!Number.isFinite(amount) || amount <= 0 || !netCell) return;

      const fees = computeFees(mode, amount);
      netCell.textContent = money(fees.net);
    });
  });
}

function calculateExchange() {
  const amountInput = document.querySelector("#calcAmount");
  const amountInputLabel = document.querySelector("#amountInputLabel");
  const netLabel = document.querySelector("#netLabel");
  const paypalFeeOutput = document.querySelector("#paypalFee");
  const deliveryFeeLabel = document.querySelector("#deliveryFeeLabel");
  const deliveryFeeOutput = document.querySelector("#deliveryFee");
  const serviceFeeLabel = document.querySelector("#serviceFeeLabel");
  const serviceFeeAmount = document.querySelector("#serviceFeeAmount");
  const totalFeeOutput = document.querySelector("#totalFee");
  const netAmountOutput = document.querySelector("#netAmount");
  const note = document.querySelector("#calculatorNote");

  if (!amountInput) return;

  const direction = getCalcDirection();
  const mode = getMode();
  const inputAmount = parseMoney(amountInput.value);

  if (amountInputLabel) {
    amountInputLabel.textContent =
      direction === "reverse" ? "Monto que quieres recibir" : "Monto PayPal a cambiar";
  }
  if (netLabel) {
    netLabel.textContent =
      direction === "reverse" ? "Debes enviar por PayPal" : "Recibirías aproximadamente";
  }
  deliveryFeeLabel.textContent = mode.deliveryLabel;
  serviceFeeLabel.textContent = mode.label;

  // En modo forward limitamos el input al rango de la modalidad.
  // En modo reverse el input es el neto deseado: dejamos el rango abierto y validamos via JS.
  if (direction === "forward") {
    amountInput.min = mode.minAmount;
    amountInput.max = mode.maxAmount;
  } else {
    amountInput.removeAttribute("min");
    amountInput.removeAttribute("max");
  }

  let gross;
  if (direction === "reverse") {
    gross = inputAmount > 0 ? reverseGross(mode, inputAmount) || 0 : 0;
  } else {
    gross = inputAmount;
  }

  const isValid = gross > 0 && gross >= mode.minAmount && gross <= mode.maxAmount;

  if (!isValid) {
    latestCalculation = null;
    paypalFeeOutput.textContent = money(0);
    deliveryFeeOutput.textContent = money(0);
    serviceFeeAmount.textContent = money(0);
    totalFeeOutput.textContent = money(0);
    netAmountOutput.textContent = money(0);

    if (inputAmount <= 0) {
      note.textContent =
        direction === "reverse"
          ? `Ingresa el monto que quieres recibir.`
          : `Ingresa un monto entre ${money(mode.minAmount)} y ${money(mode.maxAmount)} para calcular.`;
      note.classList.remove("warning");
    } else if (direction === "reverse") {
      note.textContent = `Para recibir ${money(inputAmount)} en ${mode.label} habría que enviar ${money(gross)}, fuera del rango (${money(mode.minAmount)}–${money(mode.maxAmount)}).`;
      note.classList.add("warning");
    } else {
      note.textContent = `En ${mode.label} el monto debe estar entre ${money(mode.minAmount)} y ${money(mode.maxAmount)}.`;
      note.classList.add("warning");
    }
    return;
  }

  const fees = computeFees(mode, gross);

  paypalFeeOutput.textContent = money(fees.paypal);
  deliveryFeeOutput.textContent = money(fees.delivery);
  serviceFeeAmount.textContent = money(fees.service);
  totalFeeOutput.textContent = money(fees.total);
  netAmountOutput.textContent = direction === "reverse" ? money(gross) : money(fees.net);

  latestCalculation = {
    gross,
    net: fees.net,
    serviceLabel: mode.label,
    serviceRate: mode.rate,
    deliveryTime: mode.deliveryTime,
    paypalFee: fees.paypal,
    totalFee: fees.total,
    direction,
  };
  note.textContent = `Estimado rápido. Tiempo estimado: ${mode.deliveryTime}. El detalle final se confirma por WhatsApp.`;
  note.classList.remove("warning");
}

function wireCalculator() {
  const amountInput = document.querySelector("#calcAmount");
  const serviceModeInput = document.querySelector("#serviceMode");
  const directionInput = document.querySelector("#calcDirection");
  const calculatorButton = document.querySelector("#calculatorWhatsapp");

  if (!amountInput || !serviceModeInput || !calculatorButton) return;

  [amountInput, serviceModeInput, directionInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", calculateExchange);
    input.addEventListener("change", calculateExchange);
  });

  calculatorButton.addEventListener("click", () => {
    calculateExchange();

    if (!latestCalculation) {
      amountInput.focus();
      return;
    }

    const lines = [
      "Hola, quiero cambiar saldo PayPal.",
      `Monto PayPal a enviar: ${money(latestCalculation.gross)}`,
      `Monto a recibir: ${money(latestCalculation.net)}`,
      `Modalidad: ${latestCalculation.serviceLabel}`,
      `Tiempo estimado: ${latestCalculation.deliveryTime}`,
      `Comisión total estimada: ${money(latestCalculation.totalFee)}`,
      "Deseo confirmar el detalle final y el enlace de pago.",
    ];

    window.open(`${whatsappBase}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  });

  calculateExchange();
}

// Calculadora de retiro Payoneer en cajeros de Nicaragua
const payoneerCalcConfig = {
  atmFixedFee: 3.15, // comision fija Payoneer
  atmPercentFee: 0.01855, // 1.855% del monto Payoneer
  atmOperatorFee: 7, // cargo del cajero en Nicaragua por uso de tarjeta extranjera
  atmDenomination: 20,
};

function calcPaypalReceive() {
  const netInput = document.querySelector("#ppReceiveNet");
  const grossOutput = document.querySelector("#ppReceiveGross");
  const feeOutput = document.querySelector("#ppReceiveFee");
  if (!netInput || !grossOutput || !feeOutput) return;

  const net = parseMoney(netInput.value);
  if (net <= 0) {
    grossOutput.textContent = money(0);
    feeOutput.textContent = money(0);
    return;
  }
  const denom = 1 - siteConfig.paypalPercentFee;
  if (denom <= 0) return;
  const gross = (net + siteConfig.paypalFixedFee) / denom;
  const fee = gross - net;
  grossOutput.textContent = money(gross);
  feeOutput.textContent = money(fee);
}

function calcPaypalSend() {
  const grossInput = document.querySelector("#ppSendGross");
  const feeOutput = document.querySelector("#ppSendFee");
  const netOutput = document.querySelector("#ppSendNet");
  if (!grossInput || !feeOutput || !netOutput) return;

  const gross = parseMoney(grossInput.value);
  if (gross <= 0) {
    feeOutput.textContent = money(0);
    netOutput.textContent = money(0);
    return;
  }
  const fee = gross * siteConfig.paypalPercentFee + siteConfig.paypalFixedFee;
  const net = Math.max(0, gross - fee);
  feeOutput.textContent = money(fee);
  netOutput.textContent = money(net);
}

function calcPayoneer() {
  const balanceInput = document.querySelector("#poBalance");
  const directionInput = document.querySelector("#poDirection");
  const inputLabel = document.querySelector("#poInputLabel");
  const withdrawLabel = document.querySelector("#poWithdrawLabel");
  const remainingLabel = document.querySelector("#poRemainingLabel");
  const withdrawOutput = document.querySelector("#poWithdraw");
  const feeOutput = document.querySelector("#poFee");
  const operatorFeeOutput = document.querySelector("#poOperatorFee");
  const remainingOutput = document.querySelector("#poRemaining");
  const note = document.querySelector("#poNote");
  if (!balanceInput || !withdrawOutput || !feeOutput || !operatorFeeOutput || !remainingOutput || !note) return;

  const c = payoneerCalcConfig;
  const direction = directionInput && directionInput.value === "reverse" ? "reverse" : "forward";
  const inputAmount = parseMoney(balanceInput.value);

  if (inputLabel) {
    inputLabel.textContent = direction === "reverse" ? "Monto que quieres recibir" : "Monto disponible en la tarjeta";
  }
  if (withdrawLabel) {
    withdrawLabel.textContent = direction === "reverse" ? "Vas a retirar (cajero)" : "Puedes retirar (cajero)";
  }
  if (remainingLabel) {
    remainingLabel.textContent = direction === "reverse" ? "Necesitas tener en la tarjeta" : "Queda en la tarjeta";
  }

  const pctStr = (c.atmPercentFee * 100).toFixed(3).replace(/\.?0+$/, "");

  if (inputAmount <= 0) {
    withdrawOutput.textContent = money(0);
    feeOutput.textContent = money(0);
    operatorFeeOutput.textContent = money(0);
    remainingOutput.textContent = money(0);
    note.textContent = direction === "reverse"
      ? `Ingresa el monto que quieres recibir en efectivo. Los cajeros en Nicaragua dispensan en múltiplos de $${c.atmDenomination}.`
      : `Ingresa el saldo de tu tarjeta. Los cajeros en Nicaragua dispensan en múltiplos de $${c.atmDenomination}.`;
    note.classList.remove("warning");
    return;
  }

  // Payoneer redondea la comision variable al centavo antes de sumarla.
  function payoneerFeeFor(w) {
    return c.atmFixedFee + Math.round(c.atmPercentFee * w * 100) / 100;
  }

  if (direction === "reverse") {
    // Reverse: input = monto deseado en efectivo. Redondea al multiplo de la denominacion.
    const withdraw = Math.max(0, Math.floor(inputAmount / c.atmDenomination) * c.atmDenomination);

    if (withdraw === 0) {
      withdrawOutput.textContent = money(0);
      feeOutput.textContent = money(0);
      operatorFeeOutput.textContent = money(0);
      remainingOutput.textContent = money(0);
      note.textContent = `El mínimo a retirar es $${c.atmDenomination}. Los cajeros no dispensan menos.`;
      note.classList.add("warning");
      return;
    }

    const payoneerFee = payoneerFeeFor(withdraw);
    const requiredBalance = withdraw + payoneerFee + c.atmOperatorFee;
    const bills = withdraw / c.atmDenomination;

    withdrawOutput.textContent = money(withdraw);
    feeOutput.textContent = money(payoneerFee);
    operatorFeeOutput.textContent = money(c.atmOperatorFee);
    remainingOutput.textContent = money(requiredBalance);

    let msg = `Para retirar $${withdraw} en efectivo (${bills} billete${bills === 1 ? "" : "s"} de $${c.atmDenomination}), necesitas ${money(requiredBalance)} en la tarjeta. Comisiones: $${c.atmFixedFee.toFixed(2)} Payoneer + ${pctStr}% del monto + $${c.atmOperatorFee.toFixed(2)} cargo del cajero.`;
    if (withdraw !== inputAmount) {
      msg += ` Redondeé tu monto $${inputAmount} a $${withdraw} (múltiplo de $${c.atmDenomination}).`;
    }
    note.textContent = msg;
    note.classList.remove("warning");
    return;
  }

  // Forward: input = saldo en la tarjeta. Calcula maximo retirable.
  const balance = inputAmount;
  const fixedTotal = c.atmFixedFee + c.atmOperatorFee;
  const maxRaw = (balance - fixedTotal) / (1 + c.atmPercentFee);
  let withdraw = Math.floor(maxRaw / c.atmDenomination) * c.atmDenomination;
  if (!Number.isFinite(withdraw) || withdraw < 0) withdraw = 0;

  // Por el redondeo a centavos de la comision variable, a veces alcanza para una denominacion mas.
  const tryHigher = withdraw + c.atmDenomination;
  if (tryHigher + payoneerFeeFor(tryHigher) + c.atmOperatorFee <= balance + 0.0001) {
    withdraw = tryHigher;
  }

  if (withdraw === 0) {
    const minNeeded = c.atmDenomination + fixedTotal + c.atmPercentFee * c.atmDenomination;
    withdrawOutput.textContent = money(0);
    feeOutput.textContent = money(0);
    operatorFeeOutput.textContent = money(0);
    remainingOutput.textContent = money(balance);
    note.textContent = `Saldo insuficiente. Para retirar al menos $${c.atmDenomination} en cajero necesitas ~${money(minNeeded)} cubriendo comisiones.`;
    note.classList.add("warning");
    return;
  }

  const payoneerFee = payoneerFeeFor(withdraw);
  const remaining = balance - withdraw - payoneerFee - c.atmOperatorFee;
  const bills = withdraw / c.atmDenomination;

  withdrawOutput.textContent = money(withdraw);
  feeOutput.textContent = money(payoneerFee);
  operatorFeeOutput.textContent = money(c.atmOperatorFee);
  remainingOutput.textContent = money(remaining);
  note.textContent = `Retiras $${withdraw} en efectivo (${bills} billete${bills === 1 ? "" : "s"} de $${c.atmDenomination}). Comisiones: $${c.atmFixedFee.toFixed(2)} Payoneer + ${pctStr}% del monto + $${c.atmOperatorFee.toFixed(2)} cargo del cajero.`;
  note.classList.remove("warning");
}

function wirePaypalCalc() {
  const receiveInput = document.querySelector("#ppReceiveNet");
  const sendInput = document.querySelector("#ppSendGross");
  if (receiveInput) receiveInput.addEventListener("input", calcPaypalReceive);
  if (sendInput) sendInput.addEventListener("input", calcPaypalSend);
  calcPaypalReceive();
  calcPaypalSend();
}

function wirePayoneerCalc() {
  const input = document.querySelector("#poBalance");
  const direction = document.querySelector("#poDirection");
  if (input) input.addEventListener("input", calcPayoneer);
  if (direction) direction.addEventListener("change", calcPayoneer);
  calcPayoneer();
}

function wireThemeToggle() {
  const btn = document.querySelector("#themeToggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
  });
}

setActionLinks();
renderQuickQuoteTables();
wireCalculator();
wirePaypalCalc();
wirePayoneerCalc();
wireThemeToggle();

if (window.lucide) {
  window.lucide.createIcons();
}
