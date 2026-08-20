import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_MEMORY_WRITES = "true";
process.env.JWT_SECRET = "maintenance-route-test-session-secret";
process.env.CRON_SECRET = "maintenance-route-secret-123456";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-api-key";
process.env.CLOUDINARY_API_SECRET = "test-api-secret";
delete process.env.MONGODB_URI;

const [{ default: app }, { resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

test("the upload cleanup route requires Vercel cron authorization", async () => {
  await request(app).get("/api/maintenance/uploads/cleanup").expect(401);

  const response = await request(app)
    .get("/api/maintenance/uploads/cleanup")
    .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
    .expect(200);
  assert.deepEqual(response.body.data, { claimed: 0, deleted: 0, failed: 0 });
  assert.equal(response.headers["cache-control"], "no-store");
});
