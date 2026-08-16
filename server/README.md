# Gift N Wrap API

The API is an ESM Express application. `server/app.js` exports the non-listening app for tests and Vercel, `server/dev.js` starts the local server, and `api/index.js` is the Vercel function entrypoint.

## Environment

Required for production authentication:

- `MONGODB_URI` and optionally `MONGODB_DATABASE` (defaults to `gift_n_wrap`)
- `JWT_SECRET` (at least 32 random characters in production)
- Passwordless email: `RESEND_API_KEY`, a domain-verified fixed `AUTH_EMAIL_FROM`, and a separate
  `EMAIL_OTP_SECRET` of at least 32 random characters
- One or more social providers: `GOOGLE_CLIENT_ID`; `FACEBOOK_APP_ID` plus
  `FACEBOOK_APP_SECRET`; and/or `APPLE_CLIENT_ID`
- `ADMIN_EMAIL` (the only email that receives the `admin` role)
- `CLIENT_ORIGINS` (comma-separated origins when the frontend and API are on different hosts)

Required for signed browser uploads:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_PRESET` (a **signed** preset configured with an 8 MB `max_file_size`, JPG/PNG/WebP `allowed_formats`, and metadata stripping; the API supplies the signed public ID)

The default browser flow uses Cloudinary's normal `upload` delivery type, so anyone who obtains an asset URL can view it. Accept product-reference images only, not identity documents or other sensitive media. If confidential uploads are required, switch the preset to authenticated delivery and add a signed-delivery endpoint. Expired, unused grants are cleaned lazily in bounded batches when new signatures are requested. The grant remains in MongoDB until Cloudinary confirms `ok` or `not found`; provider failures release the claim with exponential backoff for a later retry. A Cloudinary lifecycle rule can still be used as defense in depth.

Optional tuning:

- `PORT=4000`
- `AUTH_COOKIE_DAYS=7`, `COOKIE_SAME_SITE=lax`, `AUTH_COOKIE_NAME=gnw_session`
- `EMAIL_OTP_CHALLENGE_MINUTES=10`, `EMAIL_OTP_RESEND_SECONDS=60`,
  `EMAIL_OTP_MAX_ATTEMPTS=5`, `AUTH_EMAIL_REPLY_TO`
- `FACEBOOK_GRAPH_VERSION=v25.0`, `AUTH_NONCE_MINUTES=5`
- `PHONE_AUTH_CHALLENGE_MINUTES=10` (2–30 minutes; challenges are single-use and allow five checks)
- `FLAT_SHIPPING_FEE=99`, `FREE_SHIPPING_THRESHOLD=2000`, `BULK_ORDER_THRESHOLD=10`
- `WELCOME_COUPON_CODE=FIRST10`, `WELCOME_DISCOUNT_PERCENT=10`, `WELCOME_DISCOUNT_MAX=500`
- `ALLOW_DEMO_AUTH=true` enables `POST /api/auth/demo` only outside production. Never enable this on a public production deployment.
- `ALLOW_MEMORY_WRITES=true` permits non-durable writes in demo mode. It defaults to false in production; leave it false for real deployments.

If Atlas is absent or cannot be reached during startup, the service falls back to an in-memory catalogue and store. This is convenient for local review, but writes in fallback mode are process-local and non-durable. Production therefore rejects fallback writes by default, while `/api/health` returns a degraded `503` until durable storage is available. Set `ALLOW_MEMORY_WRITES=true` only for a deliberate non-production demo.

## Response contract

Successful single-resource responses use `{ "data": { ... } }`. Lists use `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`. Errors use `{ "error": { "code", "message", "details?", "requestId" } }`.

## Routes

Public:

- `GET /api/health`
- `GET /api/products`, `GET /api/products/categories`, `GET /api/products/:slug`
- `GET /api/offers/welcome`
- `GET /api/auth/status` returns which email/social providers are ready without exposing secrets.
- `POST /api/auth/email/start` with `{ email, name?, intent: "login" | "signup" }`, then
  `POST /api/auth/email/verify` with `{ challengeId, code }`. Codes are HMAC-protected at rest,
  expire, have bounded checks/resends, and are consumed once. The sender is server-controlled.
- `POST /api/auth/google`, `POST /api/auth/facebook`, and `POST /api/auth/apple` verify provider
  credentials on the server. Apple first requires `POST /api/auth/apple/nonce`; its nonce is
  short-lived and single-use.
- `GET /api/auth/me` reads the secure cookie session. `POST /api/auth/logout` always clears the
  current cookie and, when the user record is reachable, increments the session version to revoke
  the account's other issued sessions.
- Login and signup are distinct intents. Signup rejects an existing identity, login rejects a
  missing identity, and matching email text alone never silently links two provider accounts.
- Optional legacy SMS routes remain at `/api/auth/phone/*` when Twilio Verify is configured, but
  the storefront's primary passwordless flow is email.
- `POST /api/custom-inquiries`; authenticated buyers can also use `GET /api/custom-inquiries/mine`
- `POST /api/contact`

Authenticated buyer:

- `POST /api/orders`, `GET /api/orders/my`, `GET /api/orders/:id`. Send a stable `Idempotency-Key` header (8-100 letters, digits, `.`, `_`, `:`, or `-`) for each checkout attempt; a safe retry returns the original order with `Idempotency-Replayed: true`.
- `POST /api/uploads/signature` with `{ purpose: "custom-inquiries" | "orders" | "profiles" }`.
  Every returned snake_case field (`folder`, `public_id`, `overwrite`, `upload_preset`,
  `allowed_formats`, and `transformation`) is signed and must be included in the Cloudinary form.
  Each grant belongs to its authenticated requester and one non-overwritable asset ID. The
  response includes `expiresAt` and `expiresInSeconds`; order/cart grants last seven days and
  other grants last two hours. Order attachments are consumed atomically with their order, and
  same-key concurrent checkout retries return the completed idempotent order. A signature request
  also gives the expired-upload collector up to 250 ms to process a batch; it continues in the
  background on a long-running server and runs at most once per minute per process.
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
  lookup index, never Mongo TTL; on the first connection after upgrade, the server removes the
  legacy `expiresAt` TTL index before creating declared indexes. Only the separate hourly upload
  quota keeps its TTL index.
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`
- `GET /api/admin/custom-inquiries`, `PATCH /api/admin/custom-inquiries/:id`
- `GET /api/admin/contacts`, `PATCH /api/admin/contacts/:id`

All product prices, shipping, and first-order discounts are recalculated by the server. `FIRST10` is rejected for corporate gifts and line-item quantities at or above the bulk threshold. The only checkout payment method is `manual_confirmation`; the studio confirms payment separately and the initial payment status remains pending. The API never trusts client-submitted prices or roles.

MongoDB Atlas (or another replica-set deployment) is required for the transaction that atomically reserves finite inventory, assigns the first-order slot, and creates an order. Declared indexes are created after each fresh connection before the database is marked ready.

## Dependencies

Runtime: `express`, `mongoose`, `google-auth-library`, `jose`, `jsonwebtoken`, `cookie-parser`,
`cloudinary`, `zod`, `helmet`, `cors`, `compression`, `express-rate-limit`, and `dotenv` (local
launcher only). Tests use `supertest` and Node's built-in test runner.
