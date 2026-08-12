# Gift N Wrap Studio

A responsive React storefront and lightweight Express API for handmade resin art, personalized gifts, custom requests, buyer accounts, and a single protected studio admin.

## What is included

- Editorial, mobile-first storefront built with React, React Router, React-Bootstrap, Bootstrap, and custom design tokens
- Searchable/filterable product catalogue, product customization, cart, wishlist, and order-request checkout
- Delayed first-order offer (`FIRST10`, 10% up to ₹500) with eligibility checked by the API
- Google Identity Services sign-in with server-side ID-token verification
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

Open the storefront at the URL printed by Vite (normally `http://localhost:5173`; Vite may select the next free port). Vite proxies `/api` to the Express server at `http://localhost:4000`; port 4000 is API-only during `npm run dev`.

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

### Sign in with Google

1. Create an OAuth **Web application** client in Google Cloud.
2. Add `http://localhost:5173` and the final Vercel/custom domain as authorized JavaScript origins.
3. Put the same client ID in `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`.
4. Set `ADMIN_EMAIL` to the one Google account that should receive the `admin` role. Every other verified Google account is a buyer.

The API verifies the token signature, audience, issuer, and expiry with Google's Node library and stores Google's stable `sub` claim as the external identity.

### Cloudinary

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_UPLOAD_PRESET` on the server, plus `VITE_CLOUDINARY_CLOUD_NAME` in the frontend. Configure the signed upload preset to allow JPG/JPEG/PNG/WebP images up to 8 MB; the API also signs a 2400 × 2400 pixel limit transformation. Each grant is tied to one non-overwritable asset ID, and `UPLOAD_SIGNATURES_PER_HOUR` defaults to 20 per buyer. The browser asks the API for a short-lived signature and uploads directly, so the API secret never reaches the browser. Customer photos are personal data: configure restricted/authenticated delivery and an appropriate retention policy in Cloudinary before launch.

### Sessions and first-order offer

- Generate a long random value for `JWT_SECRET` in production.
- The defaults are `WELCOME_COUPON_CODE=FIRST10`, `WELCOME_DISCOUNT_PERCENT=10`, and `WELCOME_DISCOUNT_MAX=500`.
- The offer excludes corporate/bulk requests and is rejected after a buyer has an existing order.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Add the variables from `.env.example` to the appropriate Preview/Production environments.
3. Set `NODE_ENV=production`, `ALLOW_DEMO_AUTH=false`, and `VITE_ENABLE_DEMO_AUTH=false` in production.
   Also keep `ALLOW_MEMORY_WRITES=false`, so a database outage cannot create non-persistent orders.
4. Add the final domain to Google authorized origins and `CLIENT_ORIGIN`.
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
- Test the complete Google, Atlas, Cloudinary, email/phone confirmation, and admin workflow on the production domain.
- Checkout intentionally creates a manual-confirmation order request. Add a payment provider only when the studio is ready to collect online payments.
