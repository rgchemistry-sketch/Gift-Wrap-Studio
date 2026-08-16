import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-phone-auth-session-secret";
process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-token-never-used";
process.env.TWILIO_VERIFY_SERVICE_SID = "VA00000000000000000000000000000000";
delete process.env.MONGODB_URI;

const [
  { default: app },
  { resetMemoryStore },
  {
    resetPhoneAuthForTests,
    setPhoneAuthIdentityVerifierForTests,
  },
  { setPhoneVerificationProviderForTests },
] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../services/phone-auth.js"),
  import("../services/phone-verification-provider.js"),
]);

const profile = {
  googleSub: "google-phone-user-1",
  email: "buyer@example.test",
  name: "Verified Buyer",
  avatar: "",
};

let sends;

const installTestProviders = () => {
  sends = [];
  setPhoneAuthIdentityVerifierForTests(async () => profile);
  setPhoneVerificationProviderForTests({
    async start(phone) {
      sends.push(phone);
      return true;
    },
    async check(_phone, code) {
      return code === "246810";
    },
  });
};

beforeEach(() => {
  resetMemoryStore();
  resetPhoneAuthForTests();
  installTestProviders();
});

test("Google plus an Indian mobile OTP creates a session only after provider approval", async () => {
  const client = request.agent(app);
  const status = await client.get("/api/auth/phone/status").expect(200);
  assert.equal(status.body.data.configured, true);
  assert.equal(status.body.data.enabled, true);
  assert.equal(status.body.data.country, "IN");

  const started = await client
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "98765 43210",
      intent: "signup",
    })
    .expect(200);

  assert.match(started.body.data.challengeId, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(started.body.data.phoneMasked, "+91 •••••• 3210");
  assert.equal(started.body.data.expiresInSeconds, 600);
  assert.deepEqual(sends, ["+919876543210"]);
  assert.equal(JSON.stringify(started.body).includes("+919876543210"), false);
  await client.get("/api/auth/me").expect(401);

  await client
    .post("/api/auth/phone/verify")
    .send({ challengeId: started.body.data.challengeId, code: "111111" })
    .expect(401);
  const verified = await client
    .post("/api/auth/phone/verify")
    .send({ challengeId: started.body.data.challengeId, code: "246810" })
    .expect(200);

  assert.equal(verified.body.data.user.email, profile.email);
  assert.equal(verified.body.data.user.phoneVerified, true);
  assert.equal(verified.body.data.user.phoneMasked, "+91 •••••• 3210");
  assert.match(verified.headers["set-cookie"][0], /HttpOnly/i);
  const current = await client.get("/api/auth/me").expect(200);
  assert.equal(current.body.data.user.phoneVerified, true);
  assert.equal(current.body.data.user.phoneMasked, "+91 •••••• 3210");
  await client
    .post("/api/auth/phone/verify")
    .send({ challengeId: started.body.data.challengeId, code: "246810" })
    .expect(401);
});

test("returning login sends only to the previously verified matching phone", async () => {
  const signup = request.agent(app);
  const first = await signup.post("/api/auth/phone/start").send({
    credential: "google-credential-with-safe-test-length",
    email: profile.email,
    phone: "+91 9876543210",
    intent: "signup",
  });
  await signup.post("/api/auth/phone/verify").send({
    challengeId: first.body.data.challengeId,
    code: "246810",
  });

  resetPhoneAuthForTests();
  installTestProviders();

  await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "+91 9123456789",
      intent: "login",
    })
    .expect(401);
  assert.equal(sends.length, 0);

  const login = await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "+91 9876543210",
      intent: "login",
    })
    .expect(200);
  assert.equal(login.body.data.phoneMasked, "+91 •••••• 3210");
  assert.deepEqual(sends, ["+919876543210"]);
});

test("an existing Google-only account can enroll its first verified phone after OTP activation", async () => {
  const { upsertGoogleUser } = await import("../services/store.js");
  await upsertGoogleUser(profile);

  const enrollment = await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "+91 9876543210",
      intent: "login",
    })
    .expect(200);

  assert.equal(enrollment.body.data.phoneMasked, "+91 •••••• 3210");
  assert.deepEqual(sends, ["+919876543210"]);
});

test("phone authentication rejects mismatched Google email and throttles challenge retries", async () => {
  await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: "different@example.test",
      phone: "+91 9876543210",
      intent: "signup",
    })
    .expect(401);
  assert.equal(sends.length, 0);

  const first = await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "+91 9876543210",
      intent: "signup",
    })
    .expect(200);

  await request(app)
    .post("/api/auth/phone/start")
    .send({
      credential: "google-credential-with-safe-test-length",
      email: profile.email,
      phone: "+91 9876543210",
      intent: "signup",
    })
    .expect(429);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request(app)
      .post("/api/auth/phone/verify")
      .send({ challengeId: first.body.data.challengeId, code: "000000" })
      .expect(401);
  }
  await request(app)
    .post("/api/auth/phone/verify")
    .send({ challengeId: first.body.data.challengeId, code: "246810" })
    .expect(401);
});

test("phone verification remains available as a compatible optional provider", async () => {
  const phone = await request(app).get("/api/auth/phone/status").expect(200);
  assert.equal(phone.body.data.enabled, true);

  const auth = await request(app).get("/api/auth/status").expect(200);
  assert.equal(auth.body.data.details.phone.enabled, true);
  assert.match(auth.headers["cache-control"], /no-store/);
});
