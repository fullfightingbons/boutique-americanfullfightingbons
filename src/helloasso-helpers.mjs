function toAmountCents(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function toHelloAssoAmountCents(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Number.isInteger(amount) ? amount : Math.round(amount * 100);
}

function buildHelloAssoPaymentState(intent, orderTotal) {
  const order = intent?.order || null;
  const payments = Array.isArray(order?.payments) ? order.payments.filter(Boolean) : [];
  const paidAmountCents = payments.reduce((sum, payment) => sum + toHelloAssoAmountCents(payment?.amount), 0);
  const orderTotalCents = toAmountCents(orderTotal);
  const hasPayment = payments.length > 0 && paidAmountCents > 0;
  const paid = hasPayment && (orderTotalCents <= 0 || paidAmountCents >= orderTotalCents);
  return {
    order,
    hasPayment,
    paid,
    paidAmountCents,
  };
}

export {
  buildHelloAssoPaymentState,
  toAmountCents,
};
