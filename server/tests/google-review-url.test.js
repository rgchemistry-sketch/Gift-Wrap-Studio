import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGoogleReviewUrl } from "../../shared/google-review-url.js";

test("Google review and Maps links normalize to safe HTTPS URLs", () => {
  assert.equal(
    normalizeGoogleReviewUrl(" HTTPS://g.page/r/example/review "),
    "https://g.page/r/example/review",
  );
  assert.equal(
    normalizeGoogleReviewUrl("https://business.g.page/r/example/review"),
    "https://business.g.page/r/example/review",
  );
  assert.equal(
    normalizeGoogleReviewUrl("https://search.google.com/local/writereview?placeid=test"),
    "https://search.google.com/local/writereview?placeid=test",
  );
  assert.equal(
    normalizeGoogleReviewUrl("https://maps.app.goo.gl/example?g_st=iw"),
    "https://maps.app.goo.gl/example?g_st=iw",
  );
  assert.equal(normalizeGoogleReviewUrl(""), "");
});

test("unsafe, lookalike and non-Google review links are rejected", () => {
  assert.equal(normalizeGoogleReviewUrl("http://g.page/r/example/review"), null);
  assert.equal(normalizeGoogleReviewUrl("https://google.evil/review"), null);
  assert.equal(normalizeGoogleReviewUrl("https://google.com.example.test/review"), null);
  assert.equal(normalizeGoogleReviewUrl("https://example.test/review"), null);
  assert.equal(normalizeGoogleReviewUrl("https://user@g.page/r/example/review"), null);
  assert.equal(normalizeGoogleReviewUrl("https://g.page:8443/r/example/review"), null);
});
