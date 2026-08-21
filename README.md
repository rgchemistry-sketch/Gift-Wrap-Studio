# Gift N Wrap Studio

A responsive React storefront and lightweight Express API for handmade resin art, personalized gifts, custom requests, buyer accounts, and a single protected studio admin.

## What is included

- Editorial, mobile-first storefront built with React, React Router, React-Bootstrap, Bootstrap, and custom design tokens
- Searchable/filterable product catalogue, product customization, cart, wishlist, and order-request checkout
- Immediate first-order offer (`FIRST10`, 10% up to ₹500) with eligibility checked by the API
- Passwordless email codes sent from a fixed, verified Resend sender
- Google sign-in with server-side credential verification
- Buyer account and one-admin dashboard; admin access comes only from `ADMIN_EMAIL`
- MongoDB Atlas persistence with an in-memory preview store when MongoDB is not configured locally
- Signed, direct-to-Cloudinary customization uploads; the Cloudinary secret never reaches the browser
- Rate limiting, validation, secure cookies, role checks, security headers, structured errors, and request timeouts
- Vercel SPA/API routing, optimized original WebP images, accessible interactions, and reduced-motion support

Checkout first records an **order request pending studio confirmation**; submitting that request
does not take payment. After the studio confirms the design, availability, and final total, the
buyer can use the server-created Razorpay checkout flow. Online collection remains unavailable
until both the server credentials and the merchant's Razorpay Dashboard are configured.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open the storefront at `http://localhost:5173`. The dev server uses a strict port because OAuth
providers authorize exact browser origins; stop the process occupying 5173 or deliberately update
the Vite port and every provider's development origin together. Vite proxies `/api` to the Express
server at `http://localhost:4000`; port 4000 is API-only during `npm run dev`.

To run the built storefront and API together on one port, use:

```powershell
npm start
```

The `prestart` script builds the client, then Express serves the complete app at `http://localhost:4000`. Use `npm run start:api` only when an API-only process is intentional.

With `VITE_ENABLE_DEMO_AUTH=true` and `ALLOW_DEMO_AUTH=true`, the sign-in dialog exposes clearly labelled buyer/admin preview accounts. The API rejects this endpoint in production regardless of the flag. To create preview orders without Atlas, also set `ALLOW_MEMORY_WRITES=true`; keep it `false` in production.

## Environment setup

Never place server secrets in a variable prefixed with `VITE_`; Vite variables are shipped to every browser.

### MongoDB Atlas

1. Create an Atlas cluster, database user, and network access rule.
2. Copy the driver connection string to `MONGODB_URI`.
3. Optionally set `MONGODB_DATABASE`; it defaults to `gift_n_wrap`.

The connection is cached for serverless reuse. Without a URI—or when Atlas is temporarily unavailable in local development—the API reports that it is using its non-persistent preview store. Production fails closed for both catalogue reads and writes, so a database outage never exposes demo products or accepts work that could be lost.

### Authentication providers

Email is the primary passwordless flow. Create and verify a sending domain in Resend, then set
`RESEND_API_KEY`, `AUTH_EMAIL_FROM="Gift N Wrap <info@giftnwrapstudio.com>"`,
`AUTH_EMAIL_REPLY_TO=info@giftnwrapstudio.com`, and a separate random `EMAIL_OTP_SECRET` of at
least 32 characters. The sending domain must be verified in Resend. The browser can never choose
the sender. Codes are HMAC-protected at rest, expire, have bounded attempts and resend cooldowns,
and are consumed once. A preview code is returned only when `ALLOW_DEMO_AUTH=true` outside
production and Resend is not configured.

The same verified Resend sender delivers order confirmations, studio alerts, status notes,
message/request acknowledgements, and admin replies. Set `APP_URL` so those emails can link back to
the customer account and the correct admin section.

For Google:

1. Create an OAuth **Web application** client in Google Cloud.
2. Add `http://localhost:5173` and the final Vercel/custom domain as authorized JavaScript origins.
3. Put the same client ID in `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`.
4. Set `ADMIN_EMAIL` to the exact Google/email-code account that should receive the admin role.

The API verifies the token signature, audience, issuer, and expiry with Google's Node library and stores Google's stable `sub` claim as the external identity.

### Admin access

`ADMIN_EMAIL` is the only thing that grants the admin panel. The account's stored role is a cache
refreshed at login; every request re-derives the role from `ADMIN_EMAIL`, so pointing it at a
different address takes effect immediately and does not require the new administrator to sign out
and back in. A stored `role: "admin"` on any other account is ignored.

Set it in **both** places or the panel will not open in the environment you are using:

- Local: `ADMIN_EMAIL=` in `.env`
- Production: the `ADMIN_EMAIL` environment variable in the Vercel project settings, then redeploy

The address must match the signed-in account exactly (lowercase). Only Google and email-code
sign-ins are eligible for the admin role.

Google identities are keyed by the stable provider subject. A coincidentally matching email never
auto-links an existing account. A successful code sent to the account email can safely add email
login. The configured administrator address can be enrolled only through Google or a verified
email code.

### Verified customer reviews

Reviews are first-party and tied to the signed-in customer account. A customer can review a
product only after an order containing that product is marked delivered, and can leave one review
per product. The API derives purchase eligibility and the displayed product from server-owned
order data; it never trusts a submitted author, order, or product snapshot. Reviewers use a 1–5
star rating and may edit their own review from the account page. The homepage shows recent reviews
with a verified-purchase label and a privacy-safe customer name. There is no review moderation or
provider setup in the admin panel.

### Cloudinary

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET` on the server, plus `VITE_CLOUDINARY_CLOUD_NAME` in the frontend. Configure a signed upload preset for JPG/JPEG/PNG/WebP images. Each direct browser upload is completed through the API, which checks Cloudinary's authoritative asset metadata and rejects assets over 8 MB or unsafe pixel dimensions before their grant can be attached to a product, order, or inquiry. Each grant is tied to one non-overwritable asset ID, and `UPLOAD_SIGNATURES_PER_HOUR` defaults to 20 per buyer. Order/cart grants last seven days; product and inquiry grants last two hours, with both expiry values returned by the signature endpoint. Consumed product, order, and inquiry grants retain ownership provenance, while removed product assets can be retired only by the owning configured admin after no product references them. Expired unused grants are retained in MongoDB until the authenticated Vercel cleanup cron receives Cloudinary's `ok` or `not found` confirmation; failed deletions use exponential backoff. Set `CRON_SECRET`, and run `npm run db:indexes` during deployment rather than synchronizing every index on a serverless cold start. The browser asks the API for a short-lived signature and uploads directly, so the API secret never reaches the browser. Customer photos are personal data: configure restricted/authenticated delivery and an appropriate retention policy in Cloudinary before launch.

### Sessions and first-order offer

- Generate a long random value for `JWT_SECRET` in production.
- Logout increments the user's server-side session version, revoking previously issued cookies instead of only deleting the current browser cookie.
- Authentication responses are marked `Cache-Control: no-store`.
- The defaults are `WELCOME_COUPON_CODE=FIRST10`, `WELCOME_DISCOUNT_PERCENT=10`, and `WELCOME_DISCOUNT_MAX=500`.
- The offer excludes corporate/bulk requests and is rejected after a buyer has an existing order.

### Razorpay after studio confirmation

The browser never chooses the amount or creates a Razorpay Order. The API derives the confirmed
total from the saved order, creates the provider Order on the server, and stores the provider IDs.
The browser may receive the Key ID and provider Order ID needed by Standard Checkout, but it must
never receive the Key Secret or either webhook secret. A browser success callback is provisional:
the API verifies the payment signature against its own stored order ID, and fulfilment must wait
for a `captured` payment (and paid provider order) confirmed through the API/webhook flow. See
Razorpay's [Standard Checkout guide](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/?preferred-country=IN).

Configure these as **server-only** variables locally and in the matching Vercel environment:

- `RAZORPAY_MODE=test` with Test keys, or `RAZORPAY_MODE=live` with Live keys
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` (a separate secret chosen when configuring the webhook)
- `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` only during a webhook-secret rotation, so retried events
  signed with the previous secret can drain safely; remove it after the retry window
- `RAZORPAY_API_TIMEOUT_MS=8000` is optional; values are bounded to 1,000–30,000 ms
- `RAZORPAY_RECONCILE_BATCH_SIZE=20` is optional; values are bounded to 1–50 payments per run

Do not add any of these to a `VITE_` variable. Although the Key ID is safe to pass to Checkout,
keeping the whole provider configuration server-side prevents accidental secret bundling. The
integration rejects payment operations when its required configuration is missing or inconsistent.
Razorpay account state is external, however: source code cannot verify KYC/website approval,
enabled payment methods, capture settings, Live webhook activation, or subscribed events. Treat
online collection as fail-closed until an operator has completed and recorded the Dashboard checks
below.

#### Razorpay Dashboard and live cutover

- Complete KYC and submit the production website for approval. Razorpay requires a live site and
  its Terms, Privacy, Shipping, Contact, and Cancellation/Refund pages before Live API keys are
  available. See [Business Website Details](https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/?preferred-country=IN).
- Generate and test with the separate Test key pair, then create a separate Live pair and set
  `RAZORPAY_MODE=live` only in Production. Confirm the key prefix and mode agree; never expose or
  log a Key Secret. See [API Keys](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/?preferred-country=IN).
- Enable **automatic capture** in Dashboard. Never release an order merely because a payment is
  `authorized`; release only after it is `captured`. Razorpay's capture setting applies to payments
  created through the Orders API. See [Capture Settings](https://razorpay.com/docs/payments/payments/capture-settings/?preferred-country=IN).
- In both Test and Live modes as applicable, configure the stable public HTTPS webhook URL
  `https://<production-domain>/api/payments/razorpay/webhook` with its own strong secret. Subscribe
  at minimum to `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`,
  `refund.created`, `refund.processed`, `refund.failed`, and `payment.dispute.created`; monitor the
  persisted `disputed`/`review_required` status in the admin payment desk for operator review.
  Razorpay requires signature validation over the exact raw
  request body, duplicate handling, and tolerance for out-of-order delivery. See
  [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/?preferred-country=IN).
  Keep processing bounded so the endpoint returns a `2xx` response within five seconds; otherwise
  Razorpay retries and can eventually disable the webhook. See
  [Webhook setup and retries](https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/?preferred-country=IN).
- Run the complete Test-mode flow, then make one small real Live payment. Confirm the local order,
  Razorpay payment, capture, paid order, webhook deliveries, and settlement view agree. Refund that
  payment to its original payment source and confirm the `refund.processed` event before opening
  collection to customers. Use a unique `X-Refund-Idempotency` key for every intended refund and
  reuse the same key and body only for a retry. See the
  [idempotent Refund API](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/?preferred-country=IN).
- UPI Collect (manual VPA/UPI-ID/mobile-number entry) was deprecated effective
  **28 February 2026**, except Razorpay's documented exemptions. Use Standard Checkout's supported UPI
  Intent/QR experience and do not build a new Collect flow. See
  [Razorpay's UPI notice](https://razorpay.com/docs/payments/payment-methods/upi/?preferred-country=IN).

## Deploy to Vercel

1. Import the repository into Vercel.
2. Add the variables from `.env.example` and the server-only Razorpay variables above to the
   appropriate Preview/Production environments. Preview should use Test mode; Production must use
   a separate Live key pair only after the Dashboard checklist is complete.
3. Set `NODE_ENV=production`, `ALLOW_DEMO_AUTH=false`, and `VITE_ENABLE_DEMO_AUTH=false` in production.
   Also keep `ALLOW_MEMORY_WRITES=false`, so a database outage fails closed.
4. Set `APP_URL`, add the final domain to Google authorized origins, verify the sender domain in Resend, and add the final origin to `CLIENT_ORIGINS`.
5. Set a random `CRON_SECRET`, verify the Cloudinary preset is signed, and run `npm run db:indexes` against the production database during deployment.
6. Deploy. `vercel.json` builds the Vite app, sends `/api/*` (including the raw-body Razorpay
   webhook route) to the Express function, serves `index.html` for client-side routes, and
   schedules the authenticated upload-cleanup and payment-reconciliation jobs. The recovery job
   runs daily so the configuration remains valid on Vercel Hobby; webhooks and signed browser
   confirmation remain the real-time paths. On Pro or Enterprise, shorten the reconciliation
   interval after checking function usage and overlapping-run behaviour.

The project follows Vercel's current [Vite SPA routing](https://vercel.com/docs/frameworks/frontend/vite), Google's [server-side ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), and Cloudinary's [signed browser upload](https://cloudinary.com/documentation/authentication_signatures) guidance.

## Quality checks

```powershell
npm run lint
npm test
npm run build
# or all three
npm run check
```

Generated-image provenance and final prompts are recorded in [`docs/image-generation.md`](docs/image-generation.md).

## Before accepting real orders

- Replace or verify all starter catalogue products, prices, inventory, and policies; they are demonstration content.
- Test email codes, Google, logout/revocation, Atlas, Cloudinary, and the exact administrator account on the production domain.
- Confirm the legal/proprietor name, tax treatment, support email, refund operations, delivery
  estimates, and Grievance Officer details in the published Terms, Privacy, Shipping, Refund, and
  Contact pages.
- Confirm the post-confirmation Razorpay flow is still unavailable before studio approval, rejects
  client-supplied amounts, verifies the server-side payment signature, treats webhooks
  idempotently, and fulfils only captured payments. The repository cannot prove Dashboard state;
  complete the Razorpay checklist above before enabling real collection.
