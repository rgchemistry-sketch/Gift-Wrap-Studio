import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = process.env.JWT_SECRET;
process.env.CLOUDINARY_UPLOAD_PRESET = "test-locked-preset";
delete process.env.MONGODB_URI;

const [
  { default: app },
  { memoryStore, resetMemoryStore },
  { signSession },
  { env },
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/auth.js"),
  import("../config/env.js"),
]);

beforeEach(() => resetMemoryStore());

const adminUserRecord = () =>
  memoryStore.findOne("users", (user) => user.email === process.env.ADMIN_EMAIL);

const createConfiguredAdmin = (changes = {}) => memoryStore.create("users", {
  email: process.env.ADMIN_EMAIL,
  emailVerifiedAt: new Date(),
  name: "Configured Owner",
  avatar: "",
  role: "buyer",
  providers: ["email"],
  sessionVersion: 0,
  ...changes,
});

const cookieFor = (user) => `${env.cookieName}=${signSession(user)}`;

test("ADMIN_EMAIL alone grants the admin panel without a fresh sign-in", async () => {
  // Simulate an account that existed before ADMIN_EMAIL named it: the stored role is
  // still "buyer" even though the verified session email is the administrator's.
  const stored = createConfiguredAdmin();
  const cookie = cookieFor(stored);
  assert.equal(adminUserRecord().role, "buyer");

  const me = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  assert.equal(me.body.data.user.role, "admin");

  await request(app).get("/api/admin/dashboard").set("Cookie", cookie).expect(200);
});

test("a buyer whose email is not ADMIN_EMAIL is still refused, however its role is stored", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role: "buyer" }).expect(200);

  const buyer = memoryStore.findOne(
    "users",
    (user) => user.email !== process.env.ADMIN_EMAIL,
  );
  // Even a store record that claims the admin role must not open the panel: ADMIN_EMAIL
  // is the only authority.
  memoryStore.update("users", buyer.id, { role: "admin" });

  const me = await agent.get("/api/auth/me").expect(200);
  assert.equal(me.body.data.user.role, "buyer");

  const denied = await agent.get("/api/admin/dashboard").expect(403);
  assert.equal(denied.body.error.code, "FORBIDDEN");
});

test("account and admin views mask the same phone identically", async () => {
  const stored = createConfiguredAdmin({
    role: "admin",
    phone: "+919876543210",
    phoneVerifiedAt: new Date(),
  });
  const cookie = cookieFor(stored);

  const me = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  const adminList = await request(app)
    .get("/api/admin/users")
    .set("Cookie", cookie)
    .expect(200);
  const listed = adminList.body.data.find((user) => user.email === process.env.ADMIN_EMAIL);

  assert.equal(me.body.data.user.phoneMasked, "+91 •••••• 3210");
  assert.equal(listed.phone, me.body.data.user.phoneMasked);
});
