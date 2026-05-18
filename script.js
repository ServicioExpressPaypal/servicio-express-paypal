const siteConfig = {
  businessName: "Servicio Express Saldo PayPal Nicaragua",
  whatsappNumber: "50581980244",
  facebookUrl: "https://www.facebook.com/profile.php?id=61590018872357",
  defaultMessage: "Hola, vi su página web y quiero cambiar saldo PayPal.",
  paypalPercentFee: 0.0785,
  atmRate: 0.03, // costo por retiro de tarjeta, repartido entre los clientes
  atmWithdrawalFee: 10.45, // costo real de un retiro; tope para que nadie pague de mas
  wiseFixedFee: 7.41, // costo fijo de Wise para el envio internacional
  nicaraguaBankFee: 5, // estimado de lo que cobra el banco receptor en Nicaragua; ajustalo cuando lo confirmes
  serviceModes: {
    express: {
      label: "Servicio express",
      rate: 0.05,
      feeModel: "atm",
      deliveryLabel: "Costo por retiro de tarjeta",
      minAmount: 50,
      maxAmount: 200,
      deliveryTime: "menos de 24 horas",
    },
    transfer: {
      label: "Transferencia local",
      rate: 0.03,
      feeModel: "atm",
      deliveryLabel: "Costo por retiro de tarjeta",
      minAmount: 50,
      maxAmount: 500,
      deliveryTime: "1 a 2 días hábiles",
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

function deliveryFee(mode, amount) {
  if (mode.feeModel === "wise") {
    return siteConfig.wiseFixedFee + siteConfig.nicaraguaBankFee;
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

  const paypalFee = amount * siteConfig.paypalPercentFee;
  const deliveryCost = deliveryFee(mode, amount);
  const serviceFee = amount * mode.rate;
  const totalFee = paypalFee + deliveryCost + serviceFee;
  const net = Math.max(0, amount - totalFee);
  const isValid = amount >= minAmount && amount <= maxAmount;

  paypalFeeOutput.textContent = money(paypalFee);
  deliveryFeeLabel.textContent = mode.deliveryLabel;
  deliveryFeeOutput.textContent = money(deliveryCost);
  serviceFeeLabel.textContent = `${mode.label} ${formatRate(mode.rate)}`;
  serviceFeeAmount.textContent = money(serviceFee);
  totalFeeOutput.textContent = money(totalFee);
  netAmountOutput.textContent = money(net);

  if (!amount) {
    latestCalculation = null;
    note.textContent = `Ingresa un monto entre ${money(minAmount)} y ${money(maxAmount)} para calcular.`;
    note.classList.remove("warning");
    return;
  }

  if (!isValid) {
    latestCalculation = null;
    note.textContent = `En ${mode.label} el monto debe estar entre ${money(minAmount)} y ${money(maxAmount)}.`;
    note.classList.add("warning");
    return;
  }

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

function wireCalculator() {
  const amountInput = document.querySelector("#calcAmount");
  const serviceModeInput = document.querySelector("#serviceMode");
  const calculatorButton = document.querySelector("#calculatorWhatsapp");

  if (!amountInput || !serviceModeInput || !calculatorButton) return;

  [amountInput, serviceModeInput].forEach((input) => {
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
}

setActionLinks();
wireCalculator();

if (window.lucide) {
  window.lucide.createIcons();
}
