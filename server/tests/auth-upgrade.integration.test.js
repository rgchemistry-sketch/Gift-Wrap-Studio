import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "false";
process.env.JWT_SECRET = "test-auth-upgrade-session-secret-long-enough";
process.env.EMAIL_OTP_SECRET = "test-email-code-hmac-secret-long-enough";
process.env.RESEND_API_KEY = "re_test_key_never_sent";
process.env.AUTH_EMAIL_FROM = "Gift N Wrap <info@giftnwrapstudio.com>";
process.env.AUTH_EMAIL_REPLY_TO = "info@giftnwrapstudio.com";
process.env.GOOGLE_CLIENT_ID = "google-web-client-id.apps.example.test";
process.env.ADMIN_EMAIL = "rgchemistry@gmail.com";
delete process.env.MONGODB_URI;

const [
  { default: app },
  { memoryStore, resetMemoryStore },
  googleAuth,
  emailProvider,
  store,
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/social-auth.js"),
  import("../services/email-verification-provider.js"),
  import("../services/store.js"),
]);

let sentEmails;

const responseJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resetMemoryStore();
  googleAuth.resetSocialAuthForTests();
  emailProvider.resetEmailVerificationProviderForTests();
  sentEmails = [];
  emailProvider.setEmailProviderFetchForTests(async (_url, options) => {
    sentEmails.push(JSON.parse(options.body));
    return responseJson({ id: `email-${sentEmails.length}` });
  });
});

const useGoogleProfile = (profile) =>
  googleAuth.setSocialIdentityVerifierForTests("google", async () => ({
    provider: "google",
    subject: profile.subject,
    email: profile.email,
    emailVerified: true,
    name: profile.name || "Verified Google User",
    avatar: "",
  }));

const verificationCode = (message = sentEmails.at(-1)) => {
  const match = message?.text?.match(/\b(\d{6})\b/);
  assert.ok(match, "the test email should contain a six-digit code");
  return match[1];
};

test("provider status exposes only Google and email readiness without secrets", async () => {
  const response = await request(app).get("/api/auth/status").expect(200);
  assert.deepEqual(response.body.data.providers, { google: true, email: true });
  assert.equal(response.body.data.demo, false);
  assert.deepEqual(Object.keys(response.body.data.details).sort(), ["email", "google"]);
  assert.equal(response.body.data.details.email.provider, "resend");
  assert.match(response.headers["cache-control"], /no-store/);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(process.env.RESEND_API_KEY), false);
});

test("retired identity and SMS endpoints are not routed", async () => {
  for (const path of [
    "/api/auth/facebook",
    "/api/auth/apple",
    "/api/auth/apple/nonce",
  ]) {
    await request(app).post(path).send({}).expect(404);
  }
  await request(app).get("/api/auth/phone/status").expect(404);
});

test("Resend email signup uses the fixed studio sender and reply-to before creating a session", async () => {
  const client = request.agent(app);
  const started = await client
    .post("/api/auth/email/start")
    .send({ email: "buyer@example.test", name: "Email Buyer", intent: "signup" })
    .expect(200);

  assert.equal(started.body.data.email, "buyer@example.test");
  assert.match(started.body.data.emailMasked, /@example\.test$/);
  assert.equal(started.body.data.retryAfterSeconds, 60);
  assert.equal(started.body.data.expiresInMinutes, 10);
  assert.equal("previewCode" in started.body.data, false);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].from, process.env.AUTH_EMAIL_FROM);
  assert.equal(sentEmails[0].reply_to, process.env.AUTH_EMAIL_REPLY_TO);
  assert.deepEqual(sentEmails[0].to, ["buyer@example.test"]);
  const anonymous = await client.get("/api/auth/me").expect(200);
  assert.deepEqual(anonymous.body.data, { user: null, authenticated: false });

  await client
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: "000000" })
    .expect(401);
  const verified = await client
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(200);
  assert.equal(verified.body.data.user.emailVerified, true);
  assert.deepEqual(verified.body.data.user.providers, ["email"]);
  assert.match(verified.headers["set-cookie"][0], /HttpOnly/i);
  await client.get("/api/auth/me").expect(200);
  await client
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(401);
});

test("a verified email completes the sensible action even when login was selected first", async () => {
  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "missing@example.test", intent: "login" })
    .expect(200);
  assert.ok(started.body.data.challengeId);
  assert.equal(sentEmails.length, 1);

  const verified = await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(200);
  assert.equal(verified.body.data.user.email, "missing@example.test");
  assert.deepEqual(verified.body.data.user.providers, ["email"]);
});

test("email resend throttling returns retry timing and ignores consumed challenges", async () => {
  const first = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "cooldown@example.test", name: "Cooldown Buyer", intent: "signup" })
    .expect(200);

  const throttled = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "cooldown@example.test", name: "Cooldown Buyer", intent: "signup" })
    .expect(429);
  assert.equal(throttled.body.error.code, "RATE_LIMITED");
  assert.ok(throttled.body.error.details.retryAfterSeconds > 0);
  assert.ok(throttled.body.error.details.retryAfterSeconds <= 60);

  await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: first.body.data.challengeId, code: verificationCode() })
    .expect(200);

  await request(app)
    .post("/api/auth/email/start")
    .send({ email: "cooldown@example.test", intent: "login" })
    .expect(200);
});

test("concurrent email starts atomically enforce one cooldown and one delivery", async () => {
  const payload = {
    email: "simultaneous@example.test",
    name: "Simultaneous Buyer",
    intent: "signup",
  };
  const responses = await Promise.all([
    request(app).post("/api/auth/email/start").send(payload),
    request(app).post("/api/auth/email/start").send(payload),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 429]);
  assert.equal(sentEmails.length, 1);
  assert.equal(memoryStore.count("emailAuthChallenges"), 1);
  assert.equal(memoryStore.count("emailAuthCooldowns"), 1);
  const throttled = responses.find((response) => response.status === 429);
  assert.equal(throttled.body.error.code, "RATE_LIMITED");
  assert.ok(throttled.body.error.details.retryAfterSeconds > 0);
});

test("a valid email code is restored when account completion fails", async () => {
  useGoogleProfile({ subject: "recover-google", email: "recover@example.test" });
  const google = await request(app)
    .post("/api/auth/google")
    .send({ credential: "recover-google-credential-safe-0001", intent: "signup" })
    .expect(200);
  memoryStore.create(
    "authIdentities",
    {
      userId: "different-user",
      provider: "email",
      subject: "recover@example.test",
      providerEmail: "recover@example.test",
      emailVerified: true,
    },
    "email:recover@example.test",
  );

  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "recover@example.test", intent: "login" })
    .expect(200);
  const code = verificationCode();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await request(app)
      .post("/api/auth/email/verify")
      .send({ challengeId: started.body.data.challengeId, code })
      .expect(409);
    const [challenge] = memoryStore.all("emailAuthChallenges");
    assert.equal(Boolean(challenge.consumedAt), false);
    assert.equal(challenge.attempts, 0);
  }

  memoryStore.remove("authIdentities", "email:recover@example.test");
  const recovered = await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code })
    .expect(200);
  assert.equal(recovered.body.data.user.id, google.body.data.user.id);
});

test("verified email login safely links an existing Google account", async () => {
  useGoogleProfile({ subject: "google-link-1", email: "link@example.test" });
  const google = await request(app)
    .post("/api/auth/google")
    .send({ credential: "google-safe-credential-link-0001", intent: "signup" })
    .expect(200);
  assert.deepEqual(google.body.data.user.providers, ["google"]);

  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "link@example.test", intent: "login" })
    .expect(200);
  const verified = await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(200);
  assert.deepEqual(new Set(verified.body.data.user.providers), new Set(["google", "email"]));
  assert.equal(verified.body.data.user.id, google.body.data.user.id);
});

test("Google routes require an explicit login or signup intent", async () => {
  const body = { credential: "google-safe-credential-no-intent-0001" };
  for (const path of ["/api/auth/google", "/api/auth/social/google"]) {
    const response = await request(app).post(path).send(body).expect(422);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
    assert.equal(response.body.error.details.some((issue) => issue.field === "intent"), true);
  }
});

test("verified Google identity does not dead-end on the wrong account-action tab", async () => {
  useGoogleProfile({ subject: "google-intent-safe", email: "intent-safe@example.test" });
  const created = await request(app)
    .post("/api/auth/google")
    .send({ credential: "google-intent-login-safe-0001", intent: "login" })
    .expect(200);
  const existing = await request(app)
    .post("/api/auth/google")
    .send({ credential: "google-intent-signup-safe-0002", intent: "signup" })
    .expect(200);
  assert.equal(existing.body.data.user.id, created.body.data.user.id);
});

test("the configured administrator can enroll through Google", async () => {
  useGoogleProfile({ subject: "google-admin-1", email: process.env.ADMIN_EMAIL });
  const admin = await request(app)
    .post("/api/auth/google")
    .send({ credential: "google-admin-credential-safe-0001", intent: "signup" })
    .expect(200);
  assert.equal(admin.body.data.user.role, "admin");
  await request(app)
    .get("/api/admin/dashboard")
    .set("Cookie", admin.headers["set-cookie"][0].split(";")[0])
    .expect(200);
});

test("legacy Google subjects lazy-link and preserve safely shaped historical provider values", async () => {
  const legacy = await store.upsertGoogleUser({
    googleSub: "legacy-google-subject",
    email: "legacy@example.test",
    name: "Legacy Buyer",
    avatar: "",
  });
  memoryStore.update("users", legacy.id, {
    providers: ["google", "retired-provider", "unsafe provider value"],
  });
  assert.equal(await store.getAuthIdentity("google", "legacy-google-subject"), undefined);

  useGoogleProfile({ subject: "legacy-google-subject", email: "legacy@example.test" });
  const login = await request(app)
    .post("/api/auth/google")
    .send({ credential: "legacy-google-credential-safe-0001", intent: "login" })
    .expect(200);
  assert.equal(login.body.data.user.id, legacy.id);
  assert.deepEqual(login.body.data.user.providers, ["google", "retired-provider"]);
  const identity = await store.getAuthIdentity("google", "legacy-google-subject");
  assert.equal(identity.userId, legacy.id);
});

test("logout revokes a captured JWT instead of only clearing the browser cookie", async () => {
  useGoogleProfile({ subject: "logout-google-user", email: "logout@example.test" });
  const client = request.agent(app);
  const login = await client
    .post("/api/auth/google")
    .send({ credential: "logout-google-credential-safe-0001", intent: "signup" })
    .expect(200);
  const capturedCookie = login.headers["set-cookie"][0].split(";")[0];
  await client.get("/api/auth/me").expect(200);
  const logout = await client.post("/api/auth/logout").expect(200);
  assert.match(logout.headers["cache-control"], /no-store/);
  assert.match(logout.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/i);
  const revoked = await request(app)
    .get("/api/auth/me")
    .set("Cookie", capturedCookie)
    .expect(200);
  assert.deepEqual(revoked.body.data, { user: null, authenticated: false });
  assert.match(revoked.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/i);

  const newerLogin = await client
    .post("/api/auth/google")
    .send({ credential: "logout-google-credential-safe-0002", intent: "login" })
    .expect(200);
  const newerCookie = newerLogin.headers["set-cookie"][0].split(";")[0];
  const staleLogout = await request(app)
    .post("/api/auth/logout")
    .set("Cookie", capturedCookie)
    .expect(200);
  assert.equal(staleLogout.body.data.sessionsRevoked, false);
  await request(app).get("/api/auth/me").set("Cookie", newerCookie).expect(200);
});
