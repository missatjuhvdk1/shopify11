# AGENTS.md — Shopify Discount Insights App

## Project Overview

**Purpose:** Deliver actionable insights into discount and promotion performance for Shopify merchants through a data-driven dashboard.

This Shopify app provides merchants with insights into discount and promotion performance. The core feature is a dashboard that aggregates and visualizes data on referral code usage, coupon redemptions, deal applications, and estimated missed profit opportunities from untaken discounts.

**Plan:**
- **Backend:** Node.js server using Shopify Admin **REST API** to fetch order and discount data.
- **Frontend:** Embedded React app with Shopify Polaris for a native admin experience.
- **Integration:** Read-only access to orders and discounts. No store data modifications.
- **Data:** Store order data in your own database for analytics.
- **Future:** Room for exports, filters, or integrations. Focus on core metrics first.

---

## Core Metrics

Calculated for the selected time range (up to 6 months back):

- **Referral code usage:** orders and revenue per referral code.
- **Coupon redemptions:** redemptions, discount totals, and affected revenue.
- **Deal applications:** count of automatic or manual discounts applied.
- **Missed profit estimate:** rough value of discounts that could have applied but didn’t.

---

## Production Guidelines

### Security
- Validate and sanitize all inputs.
- Store sessions securely (Shopify’s session storage).
- Use HTTPS everywhere and rate-limit endpoints.

### Performance
- Use REST pagination (`page_info` links).
- Cache or store data locally in your DB.
- Test with realistic data (1k+ orders) to ensure fast loads.

### Error Handling
- Wrap API calls in try/catch.
- Return clear user messages; log details separately.
- Gracefully degrade by showing cached or last-known data.

### Testing
- Jest for backend logic.
- Cypress for frontend interactions.
- Mock Shopify responses with `nock`.

### Deployment
- Host Node server on Vercel or Heroku.
- CI/CD with GitHub Actions (lint, test, deploy).
- Semantic versioning (v1.0.0 for MVP).

---

## Data Storage and Real-Time Sync

**Goal:** Keep a clean, flexible dataset for filtering and analytics.

**Approach:**
- On install: backfill recent orders (60 days or all if `read_all_orders`).
- On events: update via `orders/create`, `orders/updated`, `orders/cancelled`, and `refunds/create` webhooks.
- Save results in your database for later filtering (product, code, refunded, etc.).

**Recommended fields:**
- Orders: id, shop id, processed_at, totals, currency, discount totals, refund/cancel flags.
- Line items: product id, quantity, totals, discounts.
- Discount apps: code, type (code/auto), title, amount.

**Guidance:**
- Upsert on every webhook event.
- Keep simple structure; add columns as needed.
- Enable filters (e.g., refunded only, code type, product, time range).

---

## Environment Variables (.env)

Shopify CLI supports `.env` for managing keys and store URLs.

```bash
shopify app env pull
```
This creates or updates `.env` from the Partner Dashboard.

Add manually if needed:
```env
SHOPIFY_API_KEY=your_key
SCOPES=read_orders,read_discounts
```

Ignore `.env` in Git. Use hosting provider (e.g., Vercel) for production variables.

---

## Hosting Model

- **Server:** Node.js app hosted on Vercel or Heroku.
- **API:** Shopify Admin **REST** API.
- **Database:** Use Postgres, MySQL, or SQLite to store orders and analytics data.
- **Cache:** Optional. Skip Redis until you scale. Add only if query load becomes heavy.
- **HTTPS:** Required in production. Set App URL and Redirect URLs in the Partner Dashboard.

---

## Coding Standards

- JavaScript (no TypeScript). Two-space indent. Semicolons required.
- Use descriptive names and small functions.
- Keep logic modular and readable.
- Prettier + ESLint before commits.

---

## Quick Start

1. Log in to Shopify CLI:
   ```bash
   shopify auth login
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Pull environment variables:
   ```bash
   shopify app env pull
   ```
4. Run the app in development:
   ```bash
   shopify app dev
   ```
5. Deploy when ready:
   ```bash
   shopify app deploy
   ```

---

**Summary:**  
Single Node app, REST API, your own database for data storage, no Redis or extra services needed until scaling. Simple, flexible foundation for analytics and growth.