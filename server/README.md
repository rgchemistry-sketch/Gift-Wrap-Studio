# Gift N Wrap API

The API is an ESM Express application. `server/app.js` exports the non-listening app for tests and Vercel, `server/dev.js` starts the local server, and `api/index.js` is the Vercel function entrypoint.

## Environment

Required for production authentication:

- `MONGODB_URI` and optionally `MONGODB_DATABASE` (defaults to `gift_n_wrap`)
- `JWT_SECRET` (at least 32 random characters in production)
- `GOOGLE_CLIENT_ID`
- `ADMIN_EMAIL` (the only email that receives the `admin` role)
- `CLIENT_ORIGINS` (comma-separated origins when the frontend and API are on different hosts)

Required for signed browser uploads:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_PRESET` (a **signed** preset configured with an 8 MB `max_file_size`, JPG/PNG/WebP `allowed_formats`, and metadata stripping; the API supplies the signed public ID)

The default browser flow uses Cloudinary's normal `upload` delivery type, so anyone who obtains an asset URL can view it. Accept product-reference images only, not identity documents or other sensitive media. If confidential uploads are required, switch the preset to authenticated delivery and add a signed-delivery endpoint. Configure a Cloudinary lifecycle/cleanup job for uploads that are abandoned before an order or inquiry is submitted.

Optional tuning:

- `PORT=4000`
- `AUTH_COOKIE_DAYS=7`, `COOKIE_SAME_SITE=lax`, `AUTH_COOKIE_NAME=gnw_session`
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
- `POST /api/auth/google` with `{ credential }`; `GET /api/auth/me`; `POST /api/auth/logout`
- `POST /api/custom-inquiries`; authenticated buyers can also use `GET /api/custom-inquiries/mine`
- `POST /api/contact`

Authenticated buyer:

- `POST /api/orders`, `GET /api/orders/my`, `GET /api/orders/:id`. Send a stable `Idempotency-Key` header (8-100 letters, digits, `.`, `_`, `:`, or `-`) for each checkout attempt; a safe retry returns the original order with `Idempotency-Replayed: true`.
- `POST /api/uploads/signature` with `{ purpose: "custom-inquiries" | "orders" | "profiles" }`. Every returned snake_case field (`folder`, `public_id`, `overwrite`, `upload_preset`, `allowed_formats`, and `transformation`) is signed and must be included in the Cloudinary form. Each grant is bound to one non-overwritable asset ID, and the Mongo-backed issuance bucket defaults to 20 grants per buyer per hour (`UPLOAD_SIGNATURES_PER_HOUR`).

Configured admin only:

- `GET /api/admin/dashboard`
- `GET|POST /api/admin/products`, `PATCH|DELETE /api/admin/products/:id` (`DELETE` archives)
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`
- `GET /api/admin/custom-inquiries`, `PATCH /api/admin/custom-inquiries/:id`
- `GET /api/admin/contacts`, `PATCH /api/admin/contacts/:id`

All product prices, shipping, and first-order discounts are recalculated by the server. `FIRST10` is rejected for corporate gifts and line-item quantities at or above the bulk threshold. The only checkout payment method is `manual_confirmation`; the studio confirms payment separately and the initial payment status remains pending. The API never trusts client-submitted prices or roles.

MongoDB Atlas (or another replica-set deployment) is required for the transaction that atomically reserves finite inventory, assigns the first-order slot, and creates an order. Declared indexes are created after each fresh connection before the database is marked ready.

## Dependencies

Runtime: `express`, `mongoose`, `google-auth-library`, `jsonwebtoken`, `cookie-parser`, `cloudinary`, `zod`, `helmet`, `cors`, `compression`, `express-rate-limit`, and `dotenv` (local launcher only). Tests use `supertest` and Node's built-in test runner.
