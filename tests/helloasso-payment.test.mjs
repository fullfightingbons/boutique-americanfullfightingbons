import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHelloAssoPaymentState,
  toAmountCents,
} from "../src/helloasso-helpers.mjs";

test("toAmountCents converts decimal euro values", () => {
  assert.equal(toAmountCents(12.34), 1234);
  assert.equal(toAmountCents(59), 5900);
  assert.equal(toAmountCents("0"), 0);
  assert.equal(toAmountCents(null), 0);
});

test("buildHelloAssoPaymentState marks fully paid order as paid", () => {
  const state = buildHelloAssoPaymentState(
    {
      order: {
        payments: [
          { amount: 5900 },
        ],
      },
    },
    59.0,
  );

  assert.equal(state.hasPayment, true);
  assert.equal(state.paid, true);
  assert.equal(state.paidAmountCents, 5900);
});

test("buildHelloAssoPaymentState keeps partial payment as unpaid", () => {
  const state = buildHelloAssoPaymentState(
    {
      order: {
        payments: [
          { amount: 2000 },
        ],
      },
    },
    59.0,
  );

  assert.equal(state.hasPayment, true);
  assert.equal(state.paid, false);
  assert.equal(state.paidAmountCents, 2000);
});
