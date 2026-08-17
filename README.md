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

Checkout records an **order request pending studio confirmation**. It does not pretend a payment was taken. Connect a payment provider later if online collection is required.

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

The connection is cached for serverless reuse. Without a URI—or when Atlas is temporarily unavailable in local development—the API reports that it is using its non-persistent preview store. Production falls back read-only instead of accepting writes that could be lost.

### Authentication providers

Email is the primary passwordless flow. Create and verify a sending domain in Resend, then set
`RESEND_API_KEY`, `AUTH_EMAIL_FROM="Gift N Wrap <info@giftnwrapstudio.com>"`,
`AUTH_EMAIL_REPLY_TO=info@giftnwrapstudio.com`, and a separate random `EMAIL_OTP_SECRET` of at
least 32 characters. The sending domain must be verified in Resend. The browser can never choose
the sender. Codes are HMAC-protected at rest, expire, have bounded attempts and resend cooldowns,
and are consumed once. A preview code is returned only when `ALLOW_DEMO_AUTH=true` outside
production and Resend is not configured.

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

### Cloudinary

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET` on the server, plus `VITE_CLOUDINARY_CLOUD_NAME` in the frontend. Configure the signed upload preset to allow JPG/JPEG/PNG/WebP images up to 8 MB; the API also signs a 2400 × 2400 pixel limit transformation. Each grant is tied to one non-overwritable asset ID, and `UPLOAD_SIGNATURES_PER_HOUR` defaults to 20 per buyer. Order/cart grants last seven days; product and other grants last two hours, with both expiry values returned by the signature endpoint. Consumed product and order grants retain ownership provenance, while removed product assets can be retired only by the owning configured admin after no product references them. Expired unused grants are retained in MongoDB until a bounded cleanup sweep receives Cloudinary's `ok` or `not found` confirmation; failed deletions use exponential backoff and retry on later signature traffic. The browser asks the API for a short-lived signature and uploads directly, so the API secret never reaches the browser. Customer photos are personal data: configure restricted/authenticated delivery and an appropriate retention policy in Cloudinary before launch.

### Sessions and first-order offer

- Generate a long random value for `JWT_SECRET` in production.
- Logout increments the user's server-side session version, revoking previously issued cookies instead of only deleting the current browser cookie.
- Authentication responses are marked `Cache-Control: no-store`.
- The defaults are `WELCOME_COUPON_CODE=FIRST10`, `WELCOME_DISCOUNT_PERCENT=10`, and `WELCOME_DISCOUNT_MAX=500`.
- The offer excludes corporate/bulk requests and is rejected after a buyer has an existing order.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Add the variables from `.env.example` to the appropriate Preview/Production environments.
3. Set `NODE_ENV=production`, `ALLOW_DEMO_AUTH=false`, and `VITE_ENABLE_DEMO_AUTH=false` in production.
   Also keep `ALLOW_MEMORY_WRITES=false`, so a database outage cannot create non-persistent orders.
4. Add the final domain to Google authorized origins, verify the sender domain in Resend, and add the final origin to `CLIENT_ORIGINS`.
5. Deploy. `vercel.json` builds the Vite app, sends `/api/*` to the Express function, and serves `index.html` for client-side routes.

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
- Checkout intentionally creates a manual-confirmation order request. Add a payment provider only when the studio is ready to collect online payments.
