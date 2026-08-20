import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "production";
process.env.ALLOW_MEMORY_WRITES = "true";
delete process.env.JWT_SECRET;
process.env.EMAIL_OTP_SECRET = "production-email-code-secret-long-enough";
process.env.RESEND_API_KEY = "re_session_config_test";
process.env.AUTH_EMAIL_FROM = "Gift N Wrap <studio@example.test>";
process.env.GOOGLE_CLIENT_ID = "google-web-client-id.apps.example.test";
delete process.env.MONGODB_URI;

let providerRequests = 0;
globalThis.fetch = async () => {
  providerRequests += 1;
  return new Response(JSON.stringify({ id: `email-${providerRequests}` }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const [{ default: app }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => {
  resetMemoryStore();
  providerRequests = 0;
});

test("auth providers fail readiness before identity work when session signing is unavailable", async () => {
  const status = await request(app).get("/api/auth/status").expect(200);
  assert.deepEqual(status.body.data.providers, { google: false, email: false });
  assert.equal(status.body.data.details.google.enabled, false);
  assert.equal(status.body.data.details.email.enabled, false);

  const email = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "buyer@example.test", intent: "signup", name: "Buyer" })
    .expect(503);
  assert.equal(email.body.error.code, "SERVICE_NOT_CONFIGURED");
  assert.deepEqual(email.body.error.details.missing, ["JWT_SECRET"]);

  const google = await request(app)
    .post("/api/auth/google")
    .send({
      credential: "google-credential-long-enough-for-validation",
      intent: "signup",
    })
    .expect(503);
  assert.equal(google.body.error.code, "SERVICE_NOT_CONFIGURED");

  assert.equal(providerRequests, 0);
  assert.equal(memoryStore.count("emailAuthChallenges"), 0);
  assert.equal(memoryStore.count("users"), 0);
  assert.equal(memoryStore.count("authIdentities"), 0);
});
