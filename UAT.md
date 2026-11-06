# The Teal Seashell — test site (UAT)

The test site is a full copy of the website with its own database and web address. It uses Stripe **test mode**, so no real card is ever charged. Every page shows a "Test site" banner, search engines are told not to list it, and every email subject starts with **[TEST]**.

## Set up the test site (one time, about 20 minutes)

You need Node.js (nodejs.org, LTS) and a free Cloudflare account. Run these in a terminal in this folder.

1. **Install and sign in**
   ```
   npm install
   npx wrangler login
   ```
2. **Create the test database.** Copy the `database_id` it prints into `wrangler.jsonc`, under `env.staging`, replacing `REPLACE_WITH_YOUR_STAGING_D1_DATABASE_ID`.
   ```
   npx wrangler d1 create teal-seashell-staging-db
   npm run db:init:staging
   ```
   To load your July–October 2026 statement history, open the database in Cloudflare → **Console**, paste the contents of `private/statements-jul-oct-2026.sql` and run it. That file stays off GitHub because it has guest names.
3. **Deploy once to get the test address**
   ```
   npm run deploy:staging
   ```
   Wrangler prints an address like `https://teal-seashell-staging.yourname.workers.dev`. Put it in `wrangler.jsonc` as the staging `SITE_URL`.
4. **Add your calendar links (optional).** Paste your Airbnb and VRBO export links into the staging `AIRBNB_ICAL_URL` and `VRBO_ICAL_URL`. The test site only reads these. **Never paste the test site's own calendar link into Airbnb or VRBO.** That would block real dates with test bookings.
5. **Add test secrets.** Use different values from your live site.
   ```
   npx wrangler secret put ADMIN_USERS --env staging
   npx wrangler secret put SESSION_SECRET --env staging
   npx wrangler secret put ICAL_TOKEN --env staging
   npx wrangler secret put STRIPE_SECRET_KEY --env staging
   ```
   - `ADMIN_USERS`: e.g. `hayden:a-test-password;tester:another-test-password`
   - `STRIPE_SECRET_KEY`: your **`sk_test_...`** key (Stripe dashboard → Developers → API keys, with "Test mode" switched on). Never use the live key here; the dashboard warns you if you do.
6. **Connect Stripe test payments.** In Stripe with Test mode on → Developers → Webhooks → Add endpoint: `https://YOUR-TEST-ADDRESS/api/stripe/webhook`, events `checkout.session.completed` and `checkout.session.expired`. Then:
   ```
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
   ```
7. **Deploy again** so the new settings take effect:
   ```
   npm run deploy:staging
   ```
8. **Email (optional).** To test emails, add `RESEND_API_KEY` with `--env staging` and fill in the staging `OWNER_EMAIL` and `FROM_EMAIL`. Use your own email addresses as the "guests" while testing.

To watch what the test site is doing while you test, run `npm run logs:staging`.

## Test script

Tick each line off as you go. Write down anything that looks wrong, with the step number and a screenshot.

### Guest website
1. Open the test address on a phone and a computer. The logo, banner, rates and calendar load, and nothing scrolls sideways on the phone.
2. Calendar shows a price under every open night: $117 on winter weeknights, $131 on winter Fridays and Saturdays, $149 over Thanksgiving.
3. If you added calendar links, nights booked on Airbnb or VRBO show crossed out.
4. Pick a booked night as check-in. It can't be selected.
5. Pick a 1-night winter stay. You see "Winter stays need at least 2 nights."
6. Pick Jul 2–4, 2027. You see "Fourth of July stays need at least 4 nights."
7. Pick a 7-night summer stay. The quote shows nightly rates, the weekly discount, $125 cleaning and 13% taxes, and the total adds up.
8. Pick 30 nights starting in January. The quote shows the $1,950 snowbird monthly rate.
9. Choose 4 guests. You see "The studio sleeps up to 3 guests."
10. Send a request with your own name and email. You see "Request sent."

### Owner dashboard
11. Open `/admin.html` while signed out. It sends you to the sign-in page.
12. Sign in with a wrong password 3 times, then the right one. Wrong attempts show an error; the right one opens the dashboard and shows "Signed in as …".
13. Sign in as your second test admin in another browser. Both can use the dashboard.
14. Requests tab shows your request as "Needs review" with the right dates and total.
15. Choose **Approve and send payment link**. Status becomes "Awaiting payment" and a payment link appears.
16. Back on the guest site, those dates now show as booked.
17. Open the payment link and pay with test card `4242 4242 4242 4242`, any future date, any CVC. You land on "Thank you. You're booked."
18. Within a minute the request shows **Confirmed**.
19. Send a second request for the same dates. It's refused because the dates are taken.
20. Send another request, then choose **Decline**. Status becomes "Declined" and the dates stay open.
21. Calendar tab: block 3 nights. They show as booked on the guest site. Remove the block and they open again.
22. Calendar tab: choose **Sync Airbnb & VRBO now**. It reports how many reservations were imported (or that no link is set).
23. Setup tab: the checklist shows Stripe in test mode, and the calendar link is listed. Don't add it to Airbnb or VRBO.

### Finances
24. Finances tab: July 2026 owner payout is **$1,702.61** and October is **$684.88**, matching your statements.
25. August and September include the Aug 30 – Sep 4 stay (guest E.P.), so they read higher than the statements by $245.32 and $27.63.
26. November onward shows no management fee.
27. Your confirmed test booking appears under Stays by guest as Direct, with no management fee and its taxes listed.
28. Add an expense ($100, one time, next month). Net for that month drops by $100. Remove it.
29. Edit an upcoming Airbnb stay, enter a guest name and a host payout. The row changes from "estimate" to "Payout entered".
30. Forecast settings: change cleaning per stay to $100 and save. Cleaning amounts update. Change it back.

### Sign-off
31. Sign out. Opening `/admin.html` sends you back to the sign-in page.

When everything passes, follow README.md to set up the live site with your **live** Stripe key and add the live calendar link to Airbnb and VRBO.

## Resetting the test site

To start the test database over:
```
npx wrangler d1 delete teal-seashell-staging-db
npx wrangler d1 create teal-seashell-staging-db
```
Put the new `database_id` in `wrangler.jsonc`, then run `npm run db:init:staging` and `npm run deploy:staging`.
