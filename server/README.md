# Gift N Wrap API

The API is an ESM Express application. `server/app.js` exports the non-listening app for tests and Vercel, `server/dev.js` starts the local server, and `api/index.js` is the Vercel function entrypoint.

## Environment

Required for production authentication:

- `MONGODB_URI` and optionally `MONGODB_DATABASE` (defaults to `gift_n_wrap`)
- `JWT_SECRET` (at least 32 random characters in production)
- Passwordless email: `RESEND_API_KEY`, domain-verified
  `AUTH_EMAIL_FROM="Gift N Wrap <info@giftnwrapstudio.com>"`,
  `AUTH_EMAIL_REPLY_TO=info@giftnwrapstudio.com`, and a separate `EMAIL_OTP_SECRET` of at least
  32 random characters
- Google identity verification: `GOOGLE_CLIENT_ID`
- `ADMIN_EMAIL` (the only email that receives the `admin` role)
- `APP_URL` (used for account/admin links in transactional email)
- `CLIENT_ORIGINS` (comma-separated origins when the frontend and API are on different hosts)
- `CRON_SECRET` (at least 16 random characters; Vercel attaches it to the upload-cleanup cron)

Required for signed browser uploads:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_PRESET` (a **signed** preset configured for JPG/PNG/WebP and metadata stripping; the API supplies the signed public ID)

The default browser flow uses Cloudinary's normal `upload` delivery type, so anyone who obtains an asset URL can view it. Accept product-reference images only, not identity documents or other sensitive media. If confidential uploads are required, switch the preset to authenticated delivery and add a signed-delivery endpoint. In production, the signature endpoint verifies that the configured preset is signed. After the direct browser upload, `POST /api/uploads/complete` reads the provider's authoritative asset metadata and unlocks the grant only when its ID, format, secure URL, byte size, and pixel dimensions satisfy the upload policy. Invalid assets are rejected and cleaned up. Expired, unused grants are processed by the authenticated Vercel cron in bounded batches. The grant remains in MongoDB until Cloudinary confirms `ok` or `not found`; provider failures release the claim with exponential backoff for a later retry. A Cloudinary lifecycle rule can still be used as defense in depth.

Optional tuning:

- `PORT=4000`
- `AUTH_COOKIE_DAYS=7`, `COOKIE_SAME_SITE=lax`, `AUTH_COOKIE_NAME=gnw_session`
- `EMAIL_OTP_CHALLENGE_MINUTES=10`, `EMAIL_OTP_RESEND_SECONDS=60`,
  `EMAIL_OTP_MAX_ATTEMPTS=5`, `AUTH_EMAIL_REPLY_TO`
- `FLAT_SHIPPING_FEE=99`, `FREE_SHIPPING_THRESHOLD=2000`, `BULK_ORDER_THRESHOLD=10`
- `WELCOME_COUPON_CODE=FIRST10`, `WELCOME_DISCOUNT_PERCENT=10`, `WELCOME_DISCOUNT_MAX=500`
- `UPLOAD_MAX_BYTES=8388608`, `UPLOAD_CLEANUP_BATCH_SIZE=20`
- `DATABASE_SYNC_INDEXES=false` in production; run `npm run db:indexes` during deployment
- `ALLOW_DEMO_AUTH=true` enables `POST /api/auth/demo` only outside production. Never enable this on a public production deployment.
- `ALLOW_MEMORY_WRITES=true` permits non-durable writes in demo mode. It defaults to false in production; leave it false for real deployments.

If Atlas is absent or cannot be reached during startup, local development falls back to an in-memory catalogue and store. Production fails closed for both reads and writes, so real customers never receive the demo catalogue during an outage; `/api/health` returns a degraded `503` until durable storage is available. Set `ALLOW_MEMORY_WRITES=true` only for a deliberate non-production demo.

Order confirmations, studio alerts, order-status messages, inquiry/contact acknowledgements, and admin replies use the same Resend sender and branded HTML/plain-text layout as authentication. API writes still succeed if a notification provider call fails; the provider status, error summary, and successful Resend message ID are logged for operations. An idempotent order replay never sends a second confirmation.

## Response contract

Successful single-resource responses use `{ "data": { ... } }`. Lists use `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`. Errors use `{ "error": { "code", "message", "details?", "requestId" } }`.

## Routes

Public:

- `GET /api/health`
- `GET /api/products`, `GET /api/products/categories`, `GET /api/products/:slug`
- `GET /api/offers/welcome`
- `GET /api/auth/status` returns whether Google and email-code sign-in are ready without exposing secrets.
- `POST /api/auth/email/start` with `{ email, name?, intent: "login" | "signup" }`, then
  `POST /api/auth/email/verify` with `{ challengeId, code }`. Codes are HMAC-protected at rest,
  expire, have bounded checks/resends, and are consumed once. The sender is server-controlled.
- `POST /api/auth/google` verifies Google credentials on the server.
- `GET /api/auth/me` reads the secure cookie session. `POST /api/auth/logout` always clears the
  current cookie and, when the user record is reachable, increments the session version to revoke
  the account's other issued sessions.
- Login and signup labels guide the initial flow, but a successfully verified mailbox completes
  the sensible account action instead of burning the code on the wrong tab. Matching email text
  alone never links an unverified provider account.

Authenticated buyer:

- `POST /api/orders`, `GET /api/orders/my`, `GET /api/orders/:id`. Send a stable `Idempotency-Key` header (8-100 letters, digits, `.`, `_`, `:`, or `-`) for each checkout attempt; a safe retry returns the original order with `Idempotency-Replayed: true`.
- `POST /api/custom-inquiries`, `GET /api/custom-inquiries/mine`. The server binds each brief to the verified session account and never trusts a submitted email as account identity.
- `POST /api/contact`. The saved message is linked to the verified session account.
- `POST /api/uploads/signature` with `{ purpose: "custom-inquiries" | "orders" }`.
  Every returned snake_case field (`folder`, `public_id`, `overwrite`, `upload_preset`,
  and `allowed_formats`) is signed and must be included in the Cloudinary form. After Cloudinary
  accepts the file, call `POST /api/uploads/complete` with `{ publicId }`; only a successfully
  verified grant can be attached to a saved record.
  Each grant belongs to its authenticated requester and one non-overwritable asset ID. The
  response includes `expiresAt` and `expiresInSeconds`; order/cart grants last seven days and
  other grants last two hours. Order attachments are consumed atomically with their order, custom
  inquiry references are consumed with the saved brief, and same-key concurrent checkout retries
  return the completed idempotent order.
- `DELETE /api/uploads/asset` with `{ publicId }` destroys the caller's unconsumed upload. The
  exact configured admin may also retire an owned, consumed product image after a successful
  product update, but only once no product references it. Its ownership record is retained as a
  deletion audit record.

Configured admin only:

- `GET /api/admin/dashboard`
- `GET|POST /api/admin/products`, `PATCH|DELETE /api/admin/products/:id` (`DELETE` archives)
- Admin product uploads use `POST /api/uploads/signature` with `{ purpose: "products" }`. New
  product images must match the admin's owned grants, which are consumed with the product write.
  Consumed product and order grants retain ownership provenance. Upload-grant expiry uses a normal
  lookup index, never Mongo TTL. Run `npm run db:indexes` during deployment to remove legacy
  indexes and synchronize declared indexes without adding migration latency to serverless cold
  starts. Only the separate hourly upload quota and rate-limit counters keep TTL indexes.
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`
- `GET /api/admin/custom-inquiries`, `PATCH /api/admin/custom-inquiries/:id`
- `GET /api/admin/contacts`, `PATCH /api/admin/contacts/:id`

All product prices, shipping, and first-order discounts are recalculated by the server. `FIRST10` is rejected for corporate gifts and line-item quantities at or above the bulk threshold. The only checkout payment method is `manual_confirmation`; the studio confirms payment separately and the initial payment status remains pending. The API never trusts client-submitted prices or roles.

MongoDB Atlas (or another replica-set deployment) is required for the transaction that atomically reserves finite inventory, assigns the first-order slot, and creates an order. API, authentication, inquiry, contact, and upload throttles use MongoDB-backed counters in production so limits survive serverless instance recycling.

## Dependencies

Runtime: `express`, `mongoose`, `google-auth-library`, `jsonwebtoken`, `cookie-parser`,
`cloudinary`, `zod`, `helmet`, `cors`, `compression`, `express-rate-limit`, and `dotenv` (local
launcher only). Tests use `supertest` and Node's built-in test runner.
