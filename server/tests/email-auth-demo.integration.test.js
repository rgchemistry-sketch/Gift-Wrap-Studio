import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-demo-email-session-secret-long-enough";
process.env.EMAIL_OTP_SECRET = "test-demo-email-hmac-secret-long-enough";
process.env.DEMO_EMAIL_OTP_CODE = "135790";
delete process.env.RESEND_API_KEY;
delete process.env.AUTH_EMAIL_FROM;
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

test("a preview code is returned only by explicitly enabled non-production demo auth", async () => {
  const status = await request(app).get("/api/auth/status").expect(200);
  assert.equal(status.body.data.providers.email, true);
  assert.equal(status.body.data.details.email.demo, true);

  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "preview@example.test", name: "Preview Buyer", intent: "signup" })
    .expect(200);
  assert.equal(started.body.data.previewCode, "135790");
  assert.equal(started.body.data.demoCode, "135790");

  const verified = await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: started.body.data.previewCode })
    .expect(200);
  assert.equal(verified.body.data.user.email, "preview@example.test");
  assert.deepEqual(verified.body.data.user.providers, ["email"]);
});
