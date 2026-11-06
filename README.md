# The Teal Seashell — direct-booking website

Your own booking site for the Fontainebleau Terrace studio. It runs on Cloudflare's free plan, so the only ongoing cost is Stripe's card fee (about 2.9% + 30¢ per booking).

**What it does**

- **Live calendar:** imports your Airbnb and VRBO calendars every 30 minutes, so booked nights show as unavailable.
- **Two-way sync:** publishes a private calendar link that Airbnb and VRBO import, so your direct bookings block those platforms too.
- **Variable pricing:** five seasons, a Friday/Saturday weekend rate, and holiday and school-break rates (spring break, Easter, Memorial Day, Fourth of July, Labor Day, Thanksgiving, Christmas, New Year's, Valentine's) that move to the right dates every year. No night prices below $117.
- **Instant quotes:** nightly prices on the calendar, weekly discount, snowbird monthly rate, cleaning fee and lodging tax.
- **Request to book:** guests send a request, you approve it, and they get a Stripe payment link. Dates are held for 23 hours while they pay, then released if unpaid.
- **Admin sign-in** at `/login.html`, with a separate username and password for each admin.
- **Owner dashboard** at `/admin.html`: approve or decline requests, mark offline payments as paid, block dates, and sync calendars on demand.
- **Finances:** forecast revenue by month and by channel (direct, Airbnb, VRBO), projected expenses and net income, occupancy against your target, lodging taxes you owe on direct bookings, and every stay listed by guest and channel.
- **Optional email notifications** through Resend (free for 3,000 emails a month).

## Test it first

Set up the test site and run through the checklist in **UAT.md** before going live. It uses a separate database and Stripe test mode, so nothing real is booked or charged.

## Setup (about 45 minutes, one time)

You need Node.js installed on your computer (nodejs.org, "LTS" version).

### 1. Install and sign in

Open a terminal (on Windows, PowerShell) in this folder and run:

```
npm install
npx wrangler login
```

A browser window opens. Create a free Cloudflare account or sign in, then allow access.

### 2. Create the database

```
npx wrangler d1 create teal-seashell-db
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Then create the tables (this runs every file in `migrations/`):

```
npm run db:init
```

### 3. Add your calendar links and site details

In `wrangler.jsonc`, fill in `vars`:

- `SITE_URL` — your site address, e.g. `https://tealseashell.com` (no slash at the end)
- `AIRBNB_ICAL_URL` — Airbnb: Calendar → Availability → Connect calendars → Export calendar
- `VRBO_ICAL_URL` — VRBO: Calendar → Import/Export → Export calendar
- `OWNER_EMAIL` — where new-request emails go
- `FROM_EMAIL` — e.g. `The Teal Seashell <bookings@tealseashell.com>` (needs a verified domain in Resend)

Edit rates, cleaning fee, tax rate, listing links and contact details in `src/config.js`.

### 4. Add your secrets

Run each line and paste the value when asked. Use long random values for the password, session secret and calendar token.

```
npx wrangler secret put ADMIN_USERS
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ICAL_TOKEN
npx wrangler secret put STRIPE_SECRET_KEY
```

- `ADMIN_USERS` — each admin as `username:password`, separated by semicolons, on one line:
  ```
  hayden:a-long-password-here;partner:a-different-long-password
  ```
  Use 12+ characters for each password. To add or remove an admin, run the command again with the new list. Removed admins are signed out right away.
- `SESSION_SECRET` and `ICAL_TOKEN` — any long random text, e.g. from a password generator
- `STRIPE_SECRET_KEY` — Stripe → Developers → API keys. Start with the `sk_test_...` key to try it out.

### 5. Deploy

```
npm run deploy
```

Wrangler prints a `*.workers.dev` address. Open it to see the site.

### 6. Connect Stripe payments

1. In Stripe → Developers → Webhooks, add an endpoint: `https://YOUR-SITE/api/stripe/webhook`
2. Select the events `checkout.session.completed` and `checkout.session.expired`.
3. Copy the signing secret (`whsec_...`) and run `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.

### 7. Send direct bookings to Airbnb and VRBO

Sign in at `/login.html` → Setup. Copy the calendar link and import it in Airbnb (Connect calendars → Import calendar) and VRBO (Import calendar).

### 8. Use your own domain (optional)

Cloudflare dashboard → Workers & Pages → teal-seashell → Settings → Domains & Routes → Add custom domain. Update `SITE_URL` and redeploy.

### 9. Email notifications (optional)

Create a free account at resend.com, verify your domain, then run `npx wrangler secret put RESEND_API_KEY`. Without it, everything still works; check the dashboard for new requests.

## Testing before going live

1. Use the Stripe test key and book yourself a stay with card `4242 4242 4242 4242`, any future expiry and any CVC.
2. Approve it in the dashboard, pay through the link, and check that the request shows as Confirmed.
3. Switch to your live `sk_live_...` key and a live-mode webhook when you're ready.

## Finances tab

Money is worked out the way your management statements do it:

**host payout − cleaning − city & county taxes = owner payout**, then **owner payout − expenses = net**. Stays from before you took over (July–October 2026) also have the former manager's 20% fee taken out, exactly as the statements show.

Each stay counts in the month it pays out (the day after check-in), the same way the statements group stays. Booked nights still count in the month they fall in, for occupancy.

- **Past stays:** load the July–October 2026 stays from your FB 219 statements by pasting `private/statements-jul-oct-2026.sql` into your database's Console in Cloudflare. That file is kept out of GitHub because it has guest names. To record any other stay or payout exactly, use *Add a past stay or payout by hand*. It replaces the estimate for any booking on the same dates.
- **Future Airbnb and VRBO stays** are estimated from your rate card minus platform fees, then $125 cleaning and 6.69% taxes. There's no management fee on stays after your *Self-managing since* date (November 1, 2026). Choose Edit on a stay to enter the real host payout.
- **Direct bookings** from this website skip Airbnb and VRBO fees, and the lodging tax on them is yours to file.
- **Blocked dates:** Airbnb shows your VRBO stays as "Not available" (and VRBO does the reverse), so those are left out of revenue. If one is really a guest stay, edit it and count it as a stay.
- **Expenses:** your $1,500/month carrying cost starts July 2026. Add others as monthly or one-time costs.
- **Forecast settings:** your self-managing date, tax rate, cleaning per stay, platform fees and your occupancy target. Update cleaning and taxes once you have your own cleaner and know what you'll file.

## Day-to-day

- **New request:** Dashboard → Requests → Approve and send payment link. Approval re-checks Airbnb and VRBO first.
- **Paid by Zelle, Venmo or check:** use Mark paid.
- **Personal stay:** Dashboard → Calendar → Block dates.
- **Refunds:** issue them from your Stripe dashboard, then Cancel booking here.

## Before you take real bookings

- **Taxes:** `taxRate` is set to 13% (7% state, 5% Bay County, 1% city), the rate other Fontainebleau Terrace listings charge. Confirm your combined Florida sales tax and Bay County tourist development tax rate, register with the Florida Department of Revenue and Bay County, and file the returns for direct bookings. Airbnb only pays these for bookings made on Airbnb.
- **Licenses:** a Florida DBPR vacation rental license and a Panama City Beach short-term rental certificate are required.
- **Policies:** the cancellation policy on the page is a placeholder. Edit it in `public/index.html`.
- **Sync delay:** Airbnb and VRBO import outside calendars every few hours. Approving requests by hand, rather than instant booking, is what protects you from double bookings.

## Files

- `src/config.js` — rates, seasons, holidays, nightly floor, fees and listing details
- `src/index.js` — server routes
- `src/ical.js` — calendar import and export
- `src/pricing.js` — quote calculation
- `src/finance.js` — revenue and expense forecast
- `public/` — the guest page (`index.html`), admin sign-in (`login.html`), dashboard (`admin.html`, `finance.js`) and styles
- `migrations/` — database tables
