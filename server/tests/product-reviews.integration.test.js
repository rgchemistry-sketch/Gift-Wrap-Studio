import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
delete process.env.MONGODB_URI;

const [{ default: app }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

const loginAs = async (role = "buyer") => {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/demo").send({ role }).expect(200);
  return { agent, user: login.body.data.user };
};

const firstProduct = async () => {
  const response = await request(app).get("/api/products?limit=1").expect(200);
  return response.body.data[0];
};

const addOrder = ({ buyerId, product, status = "delivered", orderId = "order-delivered-1" }) => {
  const now = new Date("2026-08-20T10:00:00.000Z");
  return memoryStore.create("orders", {
    buyerId,
    status,
    items: [{
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: product.images?.[0]?.url || "",
      quantity: 1,
    }],
    statusHistory: [{ status, at: now }],
    createdAt: now,
    updatedAt: now,
  }, orderId);
};

const submitReview = (agent, productId, overrides = {}) => agent
  .post("/api/reviews")
  .send({
    productId,
    rating: 5,
    comment: "Beautifully made and packed with so much care.",
    ...overrides,
  });

test("review authoring and eligibility endpoints require authentication", async () => {
  await request(app).get("/api/reviews/mine").expect(401);
  await request(app).get("/api/reviews/eligible").expect(401);
  await request(app)
    .post("/api/reviews")
    .send({ productId: "piece-1", rating: 5, comment: "A genuinely lovely handmade piece." })
    .expect(401);
  await request(app)
    .patch("/api/reviews/not-mine")
    .send({ rating: 4 })
    .expect(401);

  const publicFeed = await request(app).get("/api/reviews").expect(200);
  assert.deepEqual(publicFeed.body.data, {
    summary: {
      averageRating: 0,
      totalReviews: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    },
    reviews: [],
  });
});

test("only a delivered order owned by the signed-in buyer makes a product eligible", async () => {
  const product = await firstProduct();
  const { agent, user } = await loginAs();

  let eligible = await agent.get("/api/reviews/eligible").expect(200);
  assert.deepEqual(eligible.body.data.products, []);

  addOrder({ buyerId: "another-buyer", product, orderId: "someone-elses-delivery" });
  await submitReview(agent, product.id).expect(403);

  const placed = addOrder({ buyerId: user.id, product, status: "placed", orderId: "not-delivered" });
  await submitReview(agent, product.id).expect(403);
  memoryStore.update("orders", placed.id, {
    status: "delivered",
    statusHistory: [{ status: "delivered", at: new Date("2026-08-21T10:00:00.000Z") }],
  });

  eligible = await agent.get("/api/reviews/eligible").expect(200);
  assert.equal(eligible.body.data.products.length, 1);
  assert.deepEqual(eligible.body.data.products[0].product, {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image: product.images?.[0]?.url || "",
    href: `/product/${product.slug}`,
  });
  assert.equal(eligible.body.data.products[0].deliveredAt, "2026-08-21T10:00:00.000Z");
});

test("a buyer can create one verified review per delivered product and edit it", async () => {
  const product = await firstProduct();
  const { agent, user } = await loginAs();
  addOrder({ buyerId: user.id, product });

  const invalid = await submitReview(agent, product.id, { rating: 6, comment: "short" }).expect(422);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  assert.equal(memoryStore.count("productReviews"), 0);

  const created = await submitReview(agent, product.id).expect(201);
  assert.equal(created.body.data.rating, 5);
  assert.equal(created.body.data.authorName, "Preview B.");
  assert.equal(created.body.data.verifiedPurchase, true);
  assert.equal(created.body.data.product.href, `/product/${product.slug}`);

  const duplicate = await submitReview(agent, product.id).expect(409);
  assert.equal(duplicate.body.error.code, "CONFLICT");
  assert.equal(memoryStore.count("productReviews"), 1);

  const eligible = await agent.get("/api/reviews/eligible").expect(200);
  assert.deepEqual(eligible.body.data.products, []);

  const edited = await agent
    .patch(`/api/reviews/${created.body.data.id}`)
    .send({ rating: 4 })
    .expect(200);
  assert.equal(edited.body.data.rating, 4);
  assert.equal(edited.body.data.comment, created.body.data.comment);

  const mine = await agent.get("/api/reviews/mine").expect(200);
  assert.equal(mine.body.data.reviews.length, 1);
  assert.equal(mine.body.data.reviews[0].rating, 4);
});

test("concurrent submissions still create only one review for a buyer and product", async () => {
  const product = await firstProduct();
  const { agent, user } = await loginAs();
  addOrder({ buyerId: user.id, product });

  const responses = await Promise.all([
    submitReview(agent, product.id),
    submitReview(agent, product.id, {
      comment: "A second simultaneous request must not create another review.",
    }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(memoryStore.count("productReviews"), 1);
});

test("a review form opened by a previous account cannot write after the identity changes", async () => {
  const product = await firstProduct();
  const { agent, user } = await loginAs();
  addOrder({ buyerId: user.id, product });

  const staleCreate = await agent
    .post("/api/reviews")
    .set("X-Expected-User-Id", `${user.id}-previous`)
    .send({
      productId: product.id,
      rating: 5,
      comment: "This stale form must not create a review for the new account.",
    })
    .expect(409);
  assert.equal(staleCreate.body.error.code, "SESSION_IDENTITY_CHANGED");
  assert.equal(memoryStore.count("productReviews"), 0);

  const created = await submitReview(agent, product.id).expect(201);
  const staleEdit = await agent
    .patch(`/api/reviews/${created.body.data.id}`)
    .set("X-Expected-User-Id", `${user.id}-previous`)
    .send({ rating: 1 })
    .expect(409);
  assert.equal(staleEdit.body.error.code, "SESSION_IDENTITY_CHANGED");
  assert.equal(memoryStore.get("productReviews", created.body.data.id).rating, 5);
});

test("buyers cannot edit another account's review", async () => {
  const product = await firstProduct();
  const { agent: buyer, user } = await loginAs();
  const { agent: anotherAccount } = await loginAs("admin");
  addOrder({ buyerId: user.id, product });
  const created = await submitReview(buyer, product.id).expect(201);

  const denied = await anotherAccount
    .patch(`/api/reviews/${created.body.data.id}`)
    .send({ comment: "This account must not be able to change the buyer review." })
    .expect(404);
  assert.equal(denied.body.error.code, "NOT_FOUND");

  const unchanged = await buyer.get("/api/reviews/mine").expect(200);
  assert.equal(unchanged.body.data.reviews[0].comment, created.body.data.comment);
});

test("public reviews expose only privacy-safe display data and summarize all ratings", async () => {
  const product = await firstProduct();
  const { agent, user } = await loginAs();
  addOrder({ buyerId: user.id, product });
  await submitReview(agent, product.id).expect(201);

  memoryStore.create("productReviews", {
    buyerId: "private-buyer-id",
    productId: product.id,
    deliveredOrderId: "private-order-id",
    buyerEmail: "must-not-leak@example.test",
    rating: 3,
    comment: "The keepsake arrived safely and matched the description.",
    authorName: "Asha P.",
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: product.images?.[0]?.url || "",
      href: `/product/${product.slug}`,
    },
    verifiedPurchase: true,
    purchaseVerifiedAt: new Date(),
  }, "second-review");

  const response = await request(app).get("/api/reviews?limit=1").expect(200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.body.data.summary, {
    averageRating: 4,
    totalReviews: 2,
    distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 },
  });
  assert.equal(response.body.data.reviews.length, 1);
  assert.deepEqual(
    Object.keys(response.body.data.reviews[0]).sort(),
    [
      "authorName",
      "comment",
      "createdAt",
      "id",
      "product",
      "rating",
      "updatedAt",
      "verifiedPurchase",
    ].sort(),
  );
  const serialized = JSON.stringify(response.body.data);
  for (const secret of [
    "buyerId",
    "buyerEmail",
    "deliveredOrderId",
    "purchaseVerifiedAt",
    "private-buyer-id",
    "private-order-id",
    "must-not-leak@example.test",
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into the public response`);
  }
});
