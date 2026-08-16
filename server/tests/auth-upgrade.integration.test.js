import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "false";
process.env.JWT_SECRET = "test-auth-upgrade-session-secret-long-enough";
process.env.EMAIL_OTP_SECRET = "test-email-code-hmac-secret-long-enough";
process.env.RESEND_API_KEY = "re_test_key_never_sent";
process.env.AUTH_EMAIL_FROM = "Gift N Wrap <login@giftnwrapstudio.com>";
process.env.GOOGLE_CLIENT_ID = "google-web-client-id.apps.example.test";
process.env.FACEBOOK_APP_ID = "facebook-test-app";
process.env.FACEBOOK_APP_SECRET = "facebook-test-secret";
process.env.FACEBOOK_GRAPH_VERSION = "v22.0";
process.env.APPLE_CLIENT_ID = "com.giftnwrap.web";
process.env.ADMIN_EMAIL = "rgchemistry@gmail.com";
delete process.env.MONGODB_URI;
delete process.env.TWILIO_VERIFY_SERVICE_SID;

const [
  { default: app },
  { resetMemoryStore },
  socialAuth,
  emailProvider,
  store,
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/social-auth.js"),
  import("../services/email-verification-provider.js"),
  import("../services/store.js"),
]);

const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "apple-test-key";
publicJwk.alg = "RS256";

let sentEmails;

const responseJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resetMemoryStore();
  socialAuth.resetSocialAuthForTests();
  socialAuth.setAppleJwksForTests({ keys: [publicJwk] });
  emailProvider.resetEmailVerificationProviderForTests();
  sentEmails = [];
  emailProvider.setEmailProviderFetchForTests(async (_url, options) => {
    sentEmails.push(JSON.parse(options.body));
    return responseJson({ id: `email-${sentEmails.length}` });
  });
});

const useGoogleProfile = (profile) =>
  socialAuth.setSocialIdentityVerifierForTests("google", async () => ({
    provider: "google",
    subject: profile.subject,
    email: profile.email,
    emailVerified: true,
    name: profile.name || "Verified Google User",
    avatar: "",
  }));

const useFacebookProfile = (profile) =>
  socialAuth.setSocialIdentityVerifierForTests("facebook", async () => ({
    provider: "facebook",
    subject: profile.subject,
    email: profile.email || "",
    emailVerified: Boolean(profile.email),
    name: profile.name || "Verified Facebook User",
    avatar: "",
  }));

const verificationCode = (message = sentEmails.at(-1)) => {
  const match = message?.text?.match(/\b(\d{6})\b/);
  assert.ok(match, "the test email should contain a six-digit code");
  return match[1];
};

const appleToken = ({ subject, email, nonce }) =>
  new SignJWT({
    ...(email ? { email, email_verified: "true" } : {}),
    nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer("https://appleid.apple.com")
    .setAudience(process.env.APPLE_CLIENT_ID)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

test("provider status is no-store, frontend-compatible, and secret-free", async () => {
  const response = await request(app).get("/api/auth/status").expect(200);
  assert.deepEqual(response.body.data.providers, {
    google: true,
    facebook: true,
    apple: true,
    email: true,
  });
  assert.equal(response.body.data.details.email.provider, "resend");
  assert.match(response.headers["cache-control"], /no-store/);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(process.env.FACEBOOK_APP_SECRET), false);
  assert.equal(serialized.includes(process.env.RESEND_API_KEY), false);
});

test("Resend email signup uses the fixed sender and creates a session only after OTP", async () => {
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
  assert.deepEqual(sentEmails[0].to, ["buyer@example.test"]);
  await client.get("/api/auth/me").expect(401);

  await request(app)
    .post("/api/auth/email/start")
    .send({ email: "buyer@example.test", intent: "signup" })
    .expect(429);

  await client
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: "000000" })
    .expect(401);
  const verified = await client
    .post("/api/auth/email/verify")
    .send({
      challengeId: started.body.data.challengeId,
      code: verificationCode(),
    })
    .expect(200);
  assert.equal(verified.body.data.user.emailVerified, true);
  assert.deepEqual(verified.body.data.user.providers, ["email"]);
  assert.match(verified.headers["set-cookie"][0], /HttpOnly/i);
  assert.match(verified.headers["cache-control"], /no-store/);
  await client.get("/api/auth/me").expect(200);
  await client
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(401);
});

test("email login does not enumerate unknown accounts before code verification", async () => {
  const started = await request(app)
    .post("/api/auth/email/start")
    .send({ email: "missing@example.test", intent: "login" })
    .expect(200);
  assert.ok(started.body.data.challengeId);
  assert.equal(sentEmails.length, 1);

  const verified = await request(app)
    .post("/api/auth/email/verify")
    .send({ challengeId: started.body.data.challengeId, code: verificationCode() })
    .expect(401);
  assert.match(verified.body.error.message, /No account/i);
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

test("social login and signup intents are distinct and matching emails never auto-link", async () => {
  useFacebookProfile({ subject: "facebook-user-1", email: "social@example.test" });
  await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-access-token-safe-0001", intent: "login" })
    .expect(401);
  const signup = await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-access-token-safe-0001", intent: "signup" })
    .expect(200);
  assert.deepEqual(signup.body.data.user.providers, ["facebook"]);
  await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-access-token-safe-0001", intent: "signup" })
    .expect(409);

  resetMemoryStore();
  useGoogleProfile({ subject: "google-owner-1", email: "shared@example.test" });
  await request(app)
    .post("/api/auth/google")
    .send({ credential: "google-safe-credential-owner-0001", intent: "signup" })
    .expect(200);
  useFacebookProfile({ subject: "facebook-other-1", email: "shared@example.test" });
  const conflict = await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-access-token-safe-0002", intent: "signup" })
    .expect(409);
  assert.equal(conflict.body.error.code, "ACCOUNT_LINK_REQUIRED");
});

test("every social route rejects requests without an explicit login or signup intent", async () => {
  const googleBody = { credential: "google-safe-credential-no-intent-0001" };
  for (const path of ["/api/auth/google", "/api/auth/social/google"]) {
    const response = await request(app).post(path).send(googleBody).expect(422);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
    assert.equal(response.body.error.details.some((issue) => issue.field === "intent"), true);
  }

  const facebook = await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-access-token-no-intent-0001" })
    .expect(422);
  assert.equal(facebook.body.error.code, "VALIDATION_ERROR");
  assert.equal(facebook.body.error.details.some((issue) => issue.field === "intent"), true);

  const nonce = await request(app).post("/api/auth/apple/nonce").expect(200);
  const token = await appleToken({
    subject: "apple-no-intent",
    email: "apple-no-intent@example.test",
    nonce: nonce.body.data.nonce,
  });
  const apple = await request(app)
    .post("/api/auth/apple")
    .send({ idToken: token, nonceId: nonce.body.data.nonceId })
    .expect(422);
  assert.equal(apple.body.error.code, "VALIDATION_ERROR");
  assert.equal(apple.body.error.details.some((issue) => issue.field === "intent"), true);
});

test("administrator enrollment is restricted to Google or verified email OTP", async () => {
  useFacebookProfile({ subject: "facebook-admin-attempt", email: process.env.ADMIN_EMAIL });
  const blocked = await request(app)
    .post("/api/auth/facebook")
    .send({ accessToken: "facebook-admin-token-safe-0001", intent: "signup" })
    .expect(409);
  assert.equal(blocked.body.error.code, "ACCOUNT_LINK_REQUIRED");

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

test("Apple nonces are single-use and the stable subject supports later hidden-email login", async () => {
  const firstNonce = await request(app).post("/api/auth/apple/nonce").expect(200);
  const firstToken = await appleToken({
    subject: "apple-user-1",
    email: "apple@example.test",
    nonce: firstNonce.body.data.nonce,
  });
  const signup = await request(app)
    .post("/api/auth/apple")
    .send({
      idToken: firstToken,
      nonceId: firstNonce.body.data.nonceId,
      name: "Apple Buyer",
      intent: "signup",
    })
    .expect(200);
  assert.deepEqual(signup.body.data.user.providers, ["apple"]);

  await request(app)
    .post("/api/auth/apple")
    .send({ idToken: firstToken, nonceId: firstNonce.body.data.nonceId, intent: "login" })
    .expect(401);

  const secondNonce = await request(app).post("/api/auth/apple/nonce").expect(200);
  const hiddenEmailToken = await appleToken({
    subject: "apple-user-1",
    nonce: secondNonce.body.data.nonce,
  });
  const login = await request(app)
    .post("/api/auth/apple")
    .send({
      idToken: hiddenEmailToken,
      nonceId: secondNonce.body.data.nonceId,
      intent: "login",
    })
    .expect(200);
  assert.equal(login.body.data.user.id, signup.body.data.user.id);
  assert.equal(login.body.data.user.email, "apple@example.test");
});

test("Facebook tokens are checked against the app and stable Graph user ID", async () => {
  socialAuth.resetSocialAuthForTests();
  socialAuth.setSocialFetchForTests(async (url) => {
    const value = String(url);
    if (value.includes("debug_token")) {
      return responseJson({
        data: {
          is_valid: true,
          app_id: process.env.FACEBOOK_APP_ID,
          user_id: "facebook-graph-user",
          expires_at: Math.floor(Date.now() / 1_000) + 600,
        },
      });
    }
    return responseJson({
      id: "facebook-graph-user",
      email: "graph@example.test",
      name: "Graph Buyer",
      picture: { data: { url: "https://example.test/avatar.jpg" } },
    });
  });
  const profile = await socialAuth.verifyFacebookAccessToken({ accessToken: "safe-token" });
  assert.equal(profile.subject, "facebook-graph-user");
  assert.equal(profile.emailVerified, true);

  socialAuth.setSocialFetchForTests(async () =>
    responseJson({ data: { is_valid: true, app_id: "wrong-app", user_id: "attacker" } }),
  );
  await assert.rejects(
    socialAuth.verifyFacebookAccessToken({ accessToken: "safe-token" }),
    (error) => error.code === "UNAUTHORIZED",
  );
});

test("legacy Google subjects lazy-link without relying on an email match", async () => {
  const legacy = await store.upsertGoogleUser({
    googleSub: "legacy-google-subject",
    email: "legacy@example.test",
    name: "Legacy Buyer",
    avatar: "",
  });
  assert.equal(await store.getAuthIdentity("google", "legacy-google-subject"), undefined);

  useGoogleProfile({ subject: "legacy-google-subject", email: "legacy@example.test" });
  const login = await request(app)
    .post("/api/auth/google")
    .send({ credential: "legacy-google-credential-safe-0001", intent: "login" })
    .expect(200);
  assert.equal(login.body.data.user.id, legacy.id);
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
  await request(app).get("/api/auth/me").set("Cookie", capturedCookie).expect(401);
});
