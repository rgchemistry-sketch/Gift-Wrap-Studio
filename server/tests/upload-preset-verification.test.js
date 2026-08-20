import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "upload-preset-verification-test-secret";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = "test-api-secret";
process.env.CLOUDINARY_UPLOAD_PRESET = "locked-test-preset";
process.env.VERIFY_CLOUDINARY_UPLOAD_PRESET = "true";
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }, uploadRoutes] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
  import("../routes/uploads.js"),
]);

beforeEach(() => {
  resetMemoryStore();
  uploadRoutes.resetUploadPresetVerificationForTests();
});

test("a transient upload-preset verification failure can recover on the same instance", async () => {
  let attempts = 0;
  uploadRoutes.setUploadPresetLoaderForTests(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("temporary Cloudinary Admin API outage");
      error.http_code = 503;
      throw error;
    }
    return { settings: { max_file_size: 8 * 1_024 * 1_024 } };
  });

  const buyer = request.agent(app);
  await buyer.post("/api/auth/demo").send({ role: "buyer" }).expect(200);

  const failed = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "custom-inquiries" })
    .expect(503);
  assert.equal(failed.body.error.code, "UPLOAD_PRESET_UNVERIFIED");

  const recovered = await buyer
    .post("/api/uploads/signature")
    .send({ purpose: "custom-inquiries" })
    .expect(200);
  assert.ok(recovered.body.data.signature);
  assert.equal(attempts, 2);
});
