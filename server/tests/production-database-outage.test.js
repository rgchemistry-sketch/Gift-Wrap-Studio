import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "production";
process.env.ALLOW_MEMORY_WRITES = "false";
process.env.JWT_SECRET = "production-database-outage-test-secret";
process.env.CLIENT_ORIGINS = "https://studio.example.test";
delete process.env.MONGODB_URI;

const { default: app } = await import("../app.js");

test("production health is degraded when no durable database is available", async () => {
  const response = await request(app).get("/api/health").expect(503);
  assert.equal(response.body.data.status, "degraded");
  assert.equal(response.body.data.persistence.mode, "memory");
  assert.equal(response.body.data.writable, false);
});

test("production catalog reads fail closed instead of serving demo products", async () => {
  const response = await request(app).get("/api/products").expect(503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
});
