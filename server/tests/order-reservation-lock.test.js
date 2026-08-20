import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
delete process.env.MONGODB_URI;

const { buildMongoOrderProductReservationWriteForTests } = await import(
  "../services/store.js"
);

test("made-to-order products receive a conditional real reservation write", () => {
  const write = buildMongoOrderProductReservationWriteForTests(
    {
      inventory: null,
      orderReservationVersion: 4,
    },
    {
      productId: "507f1f77bcf86cd799439011",
      unitPrice: 1_899,
      quantity: 2,
      requiresCustomization: true,
    },
  );

  assert.deepEqual(write.update, {
    $inc: { orderReservationVersion: 1 },
  });
  assert.deepEqual(write.filter.$and, [
    {
      _id: "507f1f77bcf86cd799439011",
      active: true,
      price: 1_899,
    },
    { inventory: null },
    { orderReservationVersion: 4 },
    {
      $or: [
        { customizationAvailable: true },
        {
          customizationAvailable: { $exists: false },
          madeToOrder: { $ne: false },
        },
      ],
    },
  ]);
});

test("finite inventory reservations decrement stock and advance the same lock", () => {
  const write = buildMongoOrderProductReservationWriteForTests(
    { inventory: 8, orderReservationVersion: 0 },
    {
      productId: "507f1f77bcf86cd799439012",
      unitPrice: 2_499,
      quantity: 3,
      requiresCustomization: false,
    },
  );

  assert.deepEqual(write.update, {
    $inc: { orderReservationVersion: 1, inventory: -3 },
  });
  assert.deepEqual(write.filter.$and[1], { inventory: { $gte: 3 } });
  assert.deepEqual(write.filter.$and[2], {
    $or: [
      { orderReservationVersion: 0 },
      { orderReservationVersion: { $exists: false } },
    ],
  });
  assert.equal(write.filter.$and.length, 3);
});
