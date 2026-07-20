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
- Tiers (subtotal thresholds and percentages) are stored in a shop-level
  metafield (`tiered_discount.config`) and are editable from within the app —
  changing them doesn't require a redeploy.
- Merchants create discount codes through the app's admin UI: pick a customer
  to restrict the code to them, or leave it blank so anyone with the code can
  use it. Each code supports its own start/end dates, usage limits, and notes.

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
