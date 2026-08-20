import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "production";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-production-session-secret-that-is-long-enough";
process.env.EMAIL_OTP_SECRET = "test-production-email-secret-that-is-long-enough";
delete process.env.RESEND_API_KEY;
delete process.env.AUTH_EMAIL_FROM;
delete process.env.MONGODB_URI;

const { default: app } = await import("../app.js");

test("production never enables or returns a local preview email code", async () => {
  const status = await request(app).get("/api/auth/status").expect(200);
  assert.equal(status.body.data.providers.email, false);
  assert.equal(status.body.data.details.email.demo, false);
  assert.equal(status.body.data.demo, false);
  await request(app).post("/api/auth/demo").send({ role: "admin" }).expect(404);

  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "production@example.test", intent: "signup" })
    .expect(503);
  assert.equal(started.body.error.code, "SERVICE_NOT_CONFIGURED");
  assert.equal(JSON.stringify(started.body).includes("previewCode"), false);
});
