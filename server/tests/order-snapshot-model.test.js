import assert from "node:assert/strict";
import test from "node:test";
import { Order } from "../models/Order.js";

test("Mongo order schema retains unverified checkout contact preferences as order snapshots", () => {
  const order = new Order({
    orderNumber: "GNW-SNAPSHOT-SCHEMA",
    buyerId: "buyer-snapshot-schema",
    buyerEmail: "buyer@example.test",
    buyerName: "Mira Shah",
    items: [{
      productId: "piece-1",
      slug: "piece-1",
      name: "Name plaque",
      category: "Personalized gifts",
      unitPrice: 2_499,
      quantity: 1,
    }],
    shippingAddress: {
      recipientName: "Mira Shah",
      phone: "+919876543210",
      line1: "12 Garden Road",
      city: "Jaipur",
      state: "Rajasthan",
      postalCode: "302001",
    },
    neededBy: new Date("2026-12-04T00:00:00.000Z"),
    contactPreference: "WhatsApp",
    subtotal: 2_499,
    shippingFee: 0,
    total: 2_499,
  }).toObject();

  assert.equal(order.shippingAddress.phone, "+919876543210");
  assert.equal(order.contactPreference, "WhatsApp");
  assert.equal(order.neededBy.toISOString(), "2026-12-04T00:00:00.000Z");
  assert.equal(order.phoneVerifiedAt, undefined);
});
