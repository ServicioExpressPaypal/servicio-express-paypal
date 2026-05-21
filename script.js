const siteConfig = {
  businessName: "Servicio Express Saldo PayPal Nicaragua",
  whatsappNumber: "50586199889",
  facebookUrl: "https://www.facebook.com/profile.php?id=61590018872357",
  defaultMessage: "Hola, vi su página web y quiero cambiar saldo PayPal.",
  paypalPercentFee: 0.0785,
  atmRate: 0.03, // costo por retiro de tarjeta, repartido entre los clientes
  atmWithdrawalFee: 10.45, // costo real de un retiro; tope para que nadie pague de mas
  wiseFixedFee: 7.41, // costo fijo de Wise para el envio internacional
  bankPercent: 0.0025, // 0.25% que cobra el banco receptor en Nicaragua
  bankMinFee: 25, // comision minima del banco por transferencia recibida
  bankMaxFee: 150, // comision maxima del banco por transferencia recibida
  serviceModes: {
    express: {
      label: "Servicio express",
      rate: 0.05,
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
      minAmount: 500,
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
  const s = mode.rate;

  if (mode.feeModel === "wise") {
    const fixed = siteConfig.wiseFixedFee + siteConfig.bankMinFee;
    const denom = 1 - p - s;
    if (denom <= 0) return null;
    return (desiredNet + fixed) / denom;
  }

  // atm: prueba caso sin tope; si excede, usa el caso con tope fijo.
  const noCapDenom = 1 - p - s - siteConfig.atmRate;
  if (noCapDenom > 0) {
    const noCapGross = desiredNet / noCapDenom;
    if (noCapGross * siteConfig.atmRate <= siteConfig.atmWithdrawalFee) {
      return noCapGross;
    }
  }
  const capDenom = 1 - p - s;
  if (capDenom <= 0) return null;
  return (desiredNet + siteConfig.atmWithdrawalFee) / capDenom;
}

function deliveryFee(mode, amount) {
  if (mode.feeModel === "wise") {
    const bankFee = Math.min(
      Math.max(amount * siteConfig.bankPercent, siteConfig.bankMinFee),
      siteConfig.bankMaxFee
    );
    return siteConfig.wiseFixedFee + bankFee;
  }
  return Math.min(amount * siteConfig.atmRate, siteConfig.atmWithdrawalFee);
}

function setActionLinks() {
  const whatsappUrl = `${whatsappBase}?text=${encodeURIComponent(siteConfig.defaultMessage)}`;

  document.querySelectorAll("[data-whatsapp]").forEach((link) => {
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

function calculateExchange() {
  const amountInput = document.querySelector("#calcAmount");
  const paypalFeeOutput = document.querySelector("#paypalFee");
  const deliveryFeeLabel = document.querySelector("#deliveryFeeLabel");
  const deliveryFeeOutput = document.querySelector("#deliveryFee");
  const serviceFeeLabel = document.querySelector("#serviceFeeLabel");
  const serviceFeeAmount = document.querySelector("#serviceFeeAmount");
  const totalFeeOutput = document.querySelector("#totalFee");
  const netAmountOutput = document.querySelector("#netAmount");
  const note = document.querySelector("#calculatorNote");

  if (!amountInput) return;

  const mode = getMode();
  const minAmount = mode.minAmount;
  const maxAmount = mode.maxAmount;
  const amount = parseMoney(amountInput.value);

  amountInput.min = minAmount;
  amountInput.max = maxAmount;

  deliveryFeeLabel.textContent = mode.deliveryLabel;
  serviceFeeLabel.textContent = `${mode.label} ${formatRate(mode.rate)}`;

  const isValid = amount >= minAmount && amount <= maxAmount;

  // Fuera de rango: no se muestra el calculo, solo el mensaje.
  if (!isValid) {
    latestCalculation = null;
    paypalFeeOutput.textContent = money(0);
    deliveryFeeOutput.textContent = money(0);
    serviceFeeAmount.textContent = money(0);
    totalFeeOutput.textContent = money(0);
    netAmountOutput.textContent = money(0);

    if (!amount) {
      note.textContent = `Ingresa un monto entre ${money(minAmount)} y ${money(maxAmount)} para calcular.`;
      note.classList.remove("warning");
    } else {
      note.textContent = `En ${mode.label} el monto debe estar entre ${money(minAmount)} y ${money(maxAmount)}.`;
      note.classList.add("warning");
    }
    return;
  }

  const paypalFee = amount * siteConfig.paypalPercentFee;
  const deliveryCost = deliveryFee(mode, amount);
  const serviceFee = amount * mode.rate;
  const totalFee = paypalFee + deliveryCost + serviceFee;
  const net = Math.max(0, amount - totalFee);

  paypalFeeOutput.textContent = money(paypalFee);
  deliveryFeeOutput.textContent = money(deliveryCost);
  serviceFeeAmount.textContent = money(serviceFee);
  totalFeeOutput.textContent = money(totalFee);
  netAmountOutput.textContent = money(net);

  latestCalculation = {
    amount,
    serviceFee,
    serviceLabel: mode.label,
    serviceRate: mode.rate,
    deliveryTime: mode.deliveryTime,
    paypalFee,
    totalFee,
    net,
  };
  note.textContent = `Estimado rápido. Tiempo estimado: ${mode.deliveryTime}. El detalle final se confirma por WhatsApp.`;
  note.classList.remove("warning");
}

function calculateReverse() {
  const input = document.querySelector("#reverseAmount");
  const grossOutput = document.querySelector("#reverseGross");
  const note = document.querySelector("#reverseNote");
  if (!input || !grossOutput || !note) return;

  const mode = getMode();
  const desired = parseMoney(input.value);

  if (!desired) {
    grossOutput.textContent = money(0);
    note.textContent = `Ingresa el monto que quieres recibir. Modalidad: ${mode.label}.`;
    note.classList.remove("warning");
    return;
  }

  const gross = reverseGross(mode, desired);
  if (gross === null || !Number.isFinite(gross) || gross <= 0) {
    grossOutput.textContent = money(0);
    note.textContent = "No se puede calcular con esos valores.";
    note.classList.add("warning");
    return;
  }

  grossOutput.textContent = money(gross);

  if (gross < mode.minAmount) {
    note.textContent = `El envío de ${money(gross)} queda por debajo del mínimo de ${mode.label} (${money(mode.minAmount)}).`;
    note.classList.add("warning");
  } else if (gross > mode.maxAmount) {
    note.textContent = `El envío de ${money(gross)} excede el máximo de ${mode.label} (${money(mode.maxAmount)}). Cambia de modalidad.`;
    note.classList.add("warning");
  } else {
    note.textContent = `Si te envían ${money(gross)} en ${mode.label}, recibirás aproximadamente ${money(desired)}.`;
    note.classList.remove("warning");
  }
}

function wireCalculator() {
  const amountInput = document.querySelector("#calcAmount");
  const serviceModeInput = document.querySelector("#serviceMode");
  const calculatorButton = document.querySelector("#calculatorWhatsapp");
  const reverseInput = document.querySelector("#reverseAmount");

  if (!amountInput || !serviceModeInput || !calculatorButton) return;

  [amountInput, serviceModeInput].forEach((input) => {
    input.addEventListener("input", calculateExchange);
    input.addEventListener("change", calculateExchange);
  });

  if (reverseInput) {
    reverseInput.addEventListener("input", calculateReverse);
    serviceModeInput.addEventListener("change", calculateReverse);
  }

  calculatorButton.addEventListener("click", () => {
    calculateExchange();

    if (!latestCalculation) {
      amountInput.focus();
      return;
    }

    const lines = [
      "Hola, quiero cambiar saldo PayPal.",
      `Monto a cambiar: ${money(latestCalculation.amount)}`,
      `Modalidad: ${latestCalculation.serviceLabel}`,
      `Tiempo estimado: ${latestCalculation.deliveryTime}`,
      `Comisión total estimada: ${money(latestCalculation.totalFee)}`,
      `Recibiría aproximadamente: ${money(latestCalculation.net)}`,
      "Deseo confirmar el detalle final y el enlace de pago.",
    ];

    window.open(`${whatsappBase}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  });

  calculateExchange();
  calculateReverse();
}

// Calculadora general de PayPal (comision estandar internacional)
const paypalCalcConfig = {
  percent: 0.054,
  fixed: 0.30,
};

// Calculadora de retiro Payoneer en cajeros de Nicaragua
const payoneerCalcConfig = {
  atmFixedFee: 3.15, // comision fija Payoneer
  atmPercentFee: 0.0185, // 1.85% del monto Payoneer
  atmOperatorFee: 6, // cargo del cajero en Nicaragua por uso de tarjeta extranjera
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
  const denom = 1 - paypalCalcConfig.percent;
  if (denom <= 0) return;
  const gross = (net + paypalCalcConfig.fixed) / denom;
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
  const fee = gross * paypalCalcConfig.percent + paypalCalcConfig.fixed;
  const net = Math.max(0, gross - fee);
  feeOutput.textContent = money(fee);
  netOutput.textContent = money(net);
}

function calcPayoneer() {
  const balanceInput = document.querySelector("#poBalance");
  const withdrawOutput = document.querySelector("#poWithdraw");
  const feeOutput = document.querySelector("#poFee");
  const operatorFeeOutput = document.querySelector("#poOperatorFee");
  const remainingOutput = document.querySelector("#poRemaining");
  const note = document.querySelector("#poNote");
  if (!balanceInput || !withdrawOutput || !feeOutput || !operatorFeeOutput || !remainingOutput || !note) return;

  const c = payoneerCalcConfig;
  const balance = parseMoney(balanceInput.value);

  if (balance <= 0) {
    withdrawOutput.textContent = money(0);
    feeOutput.textContent = money(0);
    operatorFeeOutput.textContent = money(0);
    remainingOutput.textContent = money(0);
    note.textContent = `Ingresa el saldo de tu tarjeta. Los cajeros en Nicaragua dispensan en múltiplos de $${c.atmDenomination}.`;
    note.classList.remove("warning");
    return;
  }

  // W*(1 + atmPercentFee) + atmFixedFee + atmOperatorFee <= balance
  // W debe ser multiplo de la denominacion.
  const fixedTotal = c.atmFixedFee + c.atmOperatorFee;
  const maxRaw = (balance - fixedTotal) / (1 + c.atmPercentFee);
  let withdraw = Math.floor(maxRaw / c.atmDenomination) * c.atmDenomination;
  if (!Number.isFinite(withdraw) || withdraw < 0) withdraw = 0;

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

  const payoneerFee = c.atmFixedFee + c.atmPercentFee * withdraw;
  const remaining = balance - withdraw - payoneerFee - c.atmOperatorFee;
  const bills = withdraw / c.atmDenomination;

  withdrawOutput.textContent = money(withdraw);
  feeOutput.textContent = money(payoneerFee);
  operatorFeeOutput.textContent = money(c.atmOperatorFee);
  remainingOutput.textContent = money(remaining);
  note.textContent = `Retiras $${withdraw} en efectivo (${bills} billete${bills === 1 ? "" : "s"} de $${c.atmDenomination}). Comisiones: $${c.atmFixedFee.toFixed(2)} Payoneer + ${(c.atmPercentFee * 100).toFixed(2)}% del monto + $${c.atmOperatorFee.toFixed(2)} cargo del cajero.`;
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
  if (input) input.addEventListener("input", calcPayoneer);
  calcPayoneer();
}

setActionLinks();
wireCalculator();
wirePaypalCalc();
wirePayoneerCalc();

if (window.lucide) {
  window.lucide.createIcons();
}
