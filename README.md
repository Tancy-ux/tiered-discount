# Tiered Order Discount

A Shopify app that applies a tiered percentage discount to the whole order
subtotal, triggered by a discount code. Built on a Shopify Function (Order
discount class), with a custom admin UI for creating and managing codes —
no manual price rule setup per order size.

## How it works

- The discount logic runs as a [Shopify Function](https://shopify.dev/docs/api/functions)
  (`extensions/tier-order-dicount`), targeting `cart.lines.discounts.generate.run`.
  It reads the cart subtotal and applies the matching tier's percentage off
  the whole order.
- **Default tiers** (subtotal thresholds and percentages) are stored in a
  shop-level metafield (`tiered_discount.config`) and are editable from within
  the app — changing them doesn't require a redeploy. Every code uses them
  unless it has its own tiers.
- **Custom tiers per code:** on a code's page, tick "Use custom tiers for this
  code" to give that one code different tiers. They're stored on the discount
  itself (`tiered_discount.tiers`). Other codes, and later changes to the
  default tiers, don't affect it. Untick and save to return it to the defaults.
- **Bulk create** works the same way: tick "Use custom tiers for these codes"
  and every code in that batch is created with those tiers. Left unticked,
  the codes use the default tiers.
- Merchants create discount codes through the app's admin UI: pick a customer
  to restrict the code to them, or leave it blank so anyone with the code can
  use it. Each code supports its own start/end dates, usage limits, and notes.
- **Customer-specific codes only work for that customer, signed in.** The app
  stores the allowed customer IDs on the discount (`tiered_discount.customer_id`)
  and the Function gives no discount unless one of them is logged in to their
  store account. Logged-out shoppers and other customers get nothing, even with
  the code. Codes made before this existed get the lock automatically the next
  time the merchant opens the app's home page.
- The app only lists, counts and edits its own codes. Discounts made by other
  apps on the same store are never shown or changed.

### Which tiers apply

For each checkout, the Function picks the first of these that's valid:

1. The code's own tiers (`tiered_discount.tiers` on the discount)
2. The shop's default tiers (`tiered_discount.config` on the shop)
3. Built-in defaults: 5% below 50,000 · 7.5% from 50,000 · 10% from 3,00,000

A tier list that's missing, empty or broken is skipped, and any single tier
with a discount above 100% is ignored, so a bad value never breaks checkout.

### Metafields (namespace `tiered_discount`)

| Owner    | Key           | Type                     | Meaning                                           |
| -------- | ------------- | ------------------------ | ------------------------------------------------- |
| Shop     | `config`      | json                     | Default tiers: `{"tiers":[{"minSubtotal":0,"percentage":5}, ...]}` |
| Discount | `tiers`       | json                     | This code's own tiers, same shape. Missing = defaults |
| Discount | `customer_id` | single_line_text_field   | Allowed customer GIDs, comma-separated. Missing = anyone |
| Discount | `notes`       | multi_line_text_field    | Merchant notes                                    |

## Privacy and customer data

- The app's own database (Prisma) only holds Shopify sessions. No customer
  data is stored outside Shopify.
- Customer **name and email** are read live from Shopify when a merchant
  searches for a customer to restrict a code to. They're never saved.
- A customer-specific code saves the customer's **ID** on the discount
  (`tiered_discount.customer_id`), inside the merchant's store. The Function
  compares it with the signed-in buyer's ID at checkout.
- Privacy webhooks:
  - `customers/redact`: removes that customer's ID from every code. A code
    that was only for that customer is ended first, so it can never become
    usable by anyone.
  - `customers/data_request`: acknowledged. The only data is the customer ID
    on codes, already visible to the merchant in their store.
  - `shop/redact`: deletes the shop's sessions.
- The home-page sync only ever adds or updates locks. It never removes one, so
  a code whose customer list empties for any reason other than the merchant
  removing the customer in the app stays locked.
- Because the app reads customer name and email, it needs **level 2 protected
  customer data** access (Name and Email fields) in the Dev Dashboard
  (Settings > Access requests > Protected customer data). The policy page is at
  `/privacy`.

## Before resubmitting to the App Store

- Fix every point in the review feedback first. Since November 2026, each
  rejected resubmission adds a longer cooldown.
- In the Dev Dashboard, check that protected customer data is requested with
  the **Name** and **Email** fields, with reasons, and that the data protection
  details are filled in.
- The app name in `shopify.app.toml` and the App Store listing name must match.
- Complete identity verification in the Partner account if it's asked for.
- Record a screencast (English, or with English subtitles) of each test case:
  for a customer-specific code, logged out (no discount), another customer (no
  discount), the right customer (discount); plus custom tiers on one code.

## Known limitations

- **Customer-specific codes need a logged-in customer.** A guest who types the
  code at checkout, even with the right email address, gets no discount. Tell
  those customers to log in to their store account first.
- **One customer per code from the app.** The code page picks a single
  customer. The Function accepts several (comma-separated IDs) if a code was
  given more customers some other way.
- **The codes list and home-page counts read the newest 100 app discounts on
  the store**, including other apps' discounts that are then filtered out. On a
  store with more than 100, older codes don't show in the list (they still
  work at checkout).
- **The customer-lock sync covers up to 1,000 app discounts** and runs when the
  home page opens. Codes beyond that keep Shopify's own customer eligibility
  but aren't locked to a login.
- **A blank tier field is saved as 0.** Tiers are sorted by cart subtotal when
  saved.
- **Bulk create makes codes for anyone.** To restrict a code to a customer,
  create it from the home page.

## Updating a live app

Merchants on other stores keep their own default tiers and codes when the app
is updated: codes without `tiered_discount.tiers` behave exactly as before.
The one behaviour change from the customer lock is that customer-specific
codes now require that customer to be logged in.

## Tech stack

- [React Router v7](https://reactrouter.com/) (embedded admin UI)
- [Prisma](https://www.prisma.io/) + PostgreSQL for session storage
- [`@shopify/shopify-app-react-router`](https://shopify.dev/docs/api/shopify-app-react-router) for auth/OAuth
- Hosted on [Render](https://render.com/)

## Local development

1. Install dependencies: `npm install`
2. Set `DATABASE_URL` in `.env` to a Postgres connection string (a free
   [Neon](https://neon.tech) database works well for this)
3. `npm run dev` — this runs the Shopify CLI's dev flow, which handles OAuth,
   tunneling, and installing on a development store

## Deployment

The app is deployed on Render as a Node web service (no Docker), building
from this repo's `main` branch. Required environment variables:

- `DATABASE_URL` — Postgres connection string
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` — from the Partner Dashboard
- `SCOPES` — must match `access_scopes` in `shopify.app.toml`
- `SHOPIFY_APP_URL` — the app's public URL
- `NODE_ENV=production`

Run `npm run deploy` (`shopify app deploy`) to push app config and extension
changes to Shopify after any change to `shopify.app.toml` or the extension.
A Function deploy goes live on every store that has the app installed at once.
