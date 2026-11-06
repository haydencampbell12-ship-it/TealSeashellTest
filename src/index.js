import { PROPERTY, PRICING } from "./config.js";
import { buildQuote, nightRate, upcomingHolidays } from "./pricing.js";
import { syncFeeds, buildICS } from "./ical.js";
import { addDays, eachNight, overlaps, todayLocal, isISODate } from "./dates.js";
import { isAdmin, adminAccounts, makeSession, clearSession, newId, safeEqual, verifyStripe, hmacHex } from "./crypto.js";
import { createCheckout, expireCheckout } from "./stripe.js";
import { sendEmail, money } from "./email.js";
import { buildForecast, saveSettings, saveBookingNote, parseManualStay } from "./finance.js";
import { parseExpense } from "./expenses.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const err = (message, status = 400) => json({ error: message }, status);
const nowISO = () => new Date().toISOString();

async function readJSON(request) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return null;
  try { return await request.json(); } catch { return null; }
}

// ---------- Availability ----------
// Everything that makes a night unavailable: Airbnb/VRBO imports, owner blocks,
// confirmed direct bookings and approved requests still inside their payment hold.
async function busyRanges(env, { excludeRequestId = null, includeExternal = true } = {}) {
  const now = nowISO();
  const [ext, blocks, reqs] = await Promise.all([
    includeExternal ? env.DB.prepare("SELECT source, uid, start_date AS start, end_date AS end FROM ext_events").all() : { results: [] },
    env.DB.prepare("SELECT id, start_date AS start, end_date AS end, note FROM blocks").all(),
    env.DB.prepare("SELECT id, check_in AS start, check_out AS end, status FROM requests WHERE status = 'confirmed' OR (status = 'approved' AND hold_expires_at > ?)").bind(now).all()
  ]);
  return [
    ...ext.results.map((r) => ({ ...r, kind: r.source })),
    ...blocks.results.map((r) => ({ ...r, kind: "block" })),
    ...reqs.results.filter((r) => r.id !== excludeRequestId).map((r) => ({ ...r, kind: "direct" }))
  ];
}

async function isAvailable(env, checkIn, checkOut, opts) {
  const ranges = await busyRanges(env, opts);
  return !ranges.some((r) => overlaps(checkIn, checkOut, r.start, r.end));
}

// ---------- Public API ----------
async function apiProperty(env) {
  return json({
    environment: env.ENVIRONMENT === "staging" ? "staging" : "production",
    property: PROPERTY,
    pricing: {
      seasons: PRICING.seasons, holidays: upcomingHolidays(todayLocal()), weekend: PRICING.weekend,
      nightlyFloor: PRICING.nightlyFloor, monthly: PRICING.monthly, weeklyDiscount: PRICING.weeklyDiscount,
      cleaningFee: PRICING.cleaningFee, taxRate: PRICING.taxRate, maxNights: PRICING.maxNights
    }
  });
}

async function apiAvailability(env) {
  const today = todayLocal();
  const until = addDays(today, PRICING.bookingWindowDays);
  const nights = new Set();
  for (const r of await busyRanges(env)) {
    const s = r.start < today ? today : r.start;
    const e = r.end > until ? until : r.end;
    for (const n of eachNight(s, e)) nights.add(n);
  }
  // Nightly price for every bookable date, shown under each day on the calendar
  const rates = {};
  for (let d = today; d < until; d = addDays(d, 1)) rates[d] = nightRate(d).price;
  return json({ today, until, blocked: [...nights].sort(), rates }, 200, { "Cache-Control": "public, max-age=60" });
}

async function apiQuote(request, env) {
  const body = await readJSON(request);
  if (!body) return err("Send the dates as JSON.");
  const q = buildQuote(body.checkIn, body.checkOut, body.guests);
  if (!q.ok) return err(q.error);
  if (!(await isAvailable(env, body.checkIn, body.checkOut))) return err("Some of those nights are already booked. Pick different dates.", 409);
  return json({ quote: q.quote });
}

async function apiCreateRequest(request, env) {
  const body = await readJSON(request);
  if (!body) return err("Send the request as JSON.");
  if (body.website) return json({ ok: true }); // honeypot field filled in: quietly ignore bots
  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const notes = String(body.notes || "").trim().slice(0, 1500);
  if (!name) return err("Add your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Add a valid email address so we can send your confirmation.");
  const q = buildQuote(body.checkIn, body.checkOut, body.guests);
  if (!q.ok) return err(q.error);
  if (!(await isAvailable(env, body.checkIn, body.checkOut))) return err("Some of those nights were just booked. Pick different dates.", 409);

  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE email = ? AND status = 'pending'").bind(email).first();
  if (open.n >= 3) return err("You already have requests waiting for review. We'll reply soon.", 429);

  const id = newId("r_");
  const t = nowISO();
  const quote = q.quote;
  await env.DB.prepare(`INSERT INTO requests (id, created_at, updated_at, check_in, check_out, nights, guests, name, email, phone, notes, quote_json, total_cents, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .bind(id, t, t, quote.checkIn, quote.checkOut, quote.nights, quote.guests, name, email, phone, notes, JSON.stringify(quote), quote.totalCents).run();

  const site = (env.SITE_URL || "").replace(/\/$/, "");
  await Promise.all([
    sendEmail(env, env.OWNER_EMAIL, `New booking request: ${quote.checkIn} to ${quote.checkOut}`, [
      `${name} (${email}${phone ? ", " + phone : ""}) requested ${quote.nights} nights for ${quote.guests} guest(s).`,
      `Dates: ${quote.checkIn} to ${quote.checkOut}. Quoted total: ${money(quote.totalCents)}.`,
      notes ? `Message: ${notes}` : "",
      `Review it in your dashboard: ${site}/admin.html`
    ].filter(Boolean)),
    sendEmail(env, email, `We got your request for ${PROPERTY.name}`, [
      `Hi ${name},`,
      `Thanks for your request for ${quote.checkIn} to ${quote.checkOut} (${quote.nights} nights). Your quoted total is ${money(quote.totalCents)}.`,
      "We'll confirm availability and email you a secure payment link, usually within a few hours. Your dates aren't held until we approve the request.",
      `— ${PROPERTY.name}`
    ])
  ]);
  return json({ ok: true, id });
}

async function calendarExport(request, env, url) {
  const token = url.searchParams.get("token") || "";
  if (!env.ICAL_TOKEN || !safeEqual(token, env.ICAL_TOKEN)) return new Response("Not found", { status: 404 });
  const ranges = (await busyRanges(env, { includeExternal: false })).map((r) => ({
    uid: `${r.kind}-${r.id}`, start: r.start, end: r.end, summary: r.kind === "block" ? "Blocked" : "Reserved (direct)"
  }));
  return new Response(buildICS(ranges, url.host), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function stripeWebhook(request, env) {
  const payload = await request.text();
  if (!(await verifyStripe(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(payload);
  const session = event.data?.object;
  const id = session?.metadata?.request_id;
  if (!id) return json({ received: true });
  const req = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
  if (!req) return json({ received: true });

  if (event.type === "checkout.session.completed" && session.payment_status === "paid" && req.status !== "confirmed") {
    await env.DB.prepare("UPDATE requests SET status = 'confirmed', updated_at = ? WHERE id = ?").bind(nowISO(), id).run();
    const conflict = !(await isAvailable(env, req.check_in, req.check_out, { excludeRequestId: id }));
    await Promise.all([
      sendEmail(env, req.email, `You're booked at ${PROPERTY.name}!`, [
        `Hi ${req.name},`,
        `Your payment of ${money(req.total_cents)} went through and your stay from ${req.check_in} to ${req.check_out} is confirmed.`,
        `Check-in is ${PROPERTY.checkInTime} and check-out is ${PROPERTY.checkOutTime}. We'll send arrival details a few days before your trip.`,
        `— ${PROPERTY.name}`
      ]),
      sendEmail(env, env.OWNER_EMAIL, `${conflict ? "CHECK CALENDAR: " : ""}Paid: ${req.name}, ${req.check_in} to ${req.check_out}`, [
        `${req.name} paid ${money(req.total_cents)} for ${req.check_in} to ${req.check_out}.`,
        conflict ? "Warning: these dates now overlap another booking or block. Check your Airbnb/VRBO calendars right away." : "The dates are now blocked on your direct calendar feed."
      ])
    ]);
  } else if (event.type === "checkout.session.expired" && req.status === "approved") {
    await env.DB.prepare("UPDATE requests SET status = 'expired', updated_at = ? WHERE id = ?").bind(nowISO(), id).run();
  }
  return json({ received: true });
}

// ---------- Owner API ----------
async function adminLogin(request, env) {
  const accounts = adminAccounts(env);
  if (!env.SESSION_SECRET) return err("The SESSION_SECRET secret is missing. Add it in Cloudflare → Settings → Variables and Secrets.", 503);
  if (!env.ADMIN_USERS && !env.ADMIN_PASSWORD) return err("The ADMIN_USERS secret is missing. Add it in Cloudflare → Settings → Variables and Secrets.", 503);
  if (!accounts.size) return err("ADMIN_USERS is set but isn't in the right form. It should look like hayden:password;renae:password with no quotes or spaces in the usernames.", 503);
  const body = await readJSON(request);
  const username = String(body?.username || "").trim().toLowerCase() || (accounts.size === 1 ? [...accounts.keys()][0] : "");
  const lockKey = "login_fails";
  const lock = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(lockKey).first();
  const fails = lock ? JSON.parse(lock.value) : { n: 0, since: 0 };
  if (fails.n >= 8 && Date.now() - fails.since < 15 * 60 * 1000) return err("Too many sign-in attempts. Try again in 15 minutes.", 429);
  // Compare HMACs so the check takes the same time whatever was typed
  const expected = accounts.get(username) ?? crypto.randomUUID();
  const a = await hmacHex(env.SESSION_SECRET, String(body?.password || ""));
  const b = await hmacHex(env.SESSION_SECRET, expected);
  if (!accounts.has(username) || !safeEqual(a, b)) {
    const next = Date.now() - fails.since > 15 * 60 * 1000 ? { n: 1, since: Date.now() } : { n: fails.n + 1, since: fails.since };
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(lockKey, JSON.stringify(next)).run();
    return err("That username or password isn't right.", 401);
  }
  await env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(lockKey).run();
  return json({ ok: true, user: username }, 200, { "Set-Cookie": await makeSession(env, username) });
}

async function adminOverview(env, url, adminUser) {
  const today = todayLocal();
  const [reqs, blocks, ext, sync] = await Promise.all([
    env.DB.prepare("SELECT * FROM requests WHERE status IN ('pending','approved') OR check_out >= ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, check_in LIMIT 300").bind(addDays(today, -30)).all(),
    env.DB.prepare("SELECT * FROM blocks WHERE end_date >= ? ORDER BY start_date").bind(today).all(),
    env.DB.prepare("SELECT source, start_date, end_date, summary FROM ext_events WHERE end_date >= ? ORDER BY start_date LIMIT 300").bind(today).all(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'last_sync'").first()
  ]);
  const extList = ext.results;
  const requests = reqs.results.map((r) => ({
    ...r,
    quote: JSON.parse(r.quote_json),
    quote_json: undefined,
    // flag direct bookings that collide with an Airbnb/VRBO reservation or a block
    conflict: (r.status === "confirmed" || r.status === "approved" || r.status === "pending") &&
      (extList.some((e) => overlaps(r.check_in, r.check_out, e.start_date, e.end_date)) ||
       blocks.results.some((b) => overlaps(r.check_in, r.check_out, b.start_date, b.end_date)))
  }));
  const site = (env.SITE_URL || url.origin).replace(/\/$/, "");
  return json({
    today, user: adminUser,
    requests, blocks: blocks.results, external: extList,
    lastSync: sync ? JSON.parse(sync.value) : null,
    setup: {
      environment: env.ENVIRONMENT === "staging" ? "staging" : "production",
      siteUrl: site,
      calendarExportUrl: env.ICAL_TOKEN ? `${site}/calendar.ics?token=${env.ICAL_TOKEN}` : null,
      airbnbFeed: !!env.AIRBNB_ICAL_URL, vrboFeed: !!env.VRBO_ICAL_URL,
      stripe: !!env.STRIPE_SECRET_KEY, stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
      stripeTestMode: (env.STRIPE_SECRET_KEY || "").startsWith("sk_test_"),
      email: !!(env.RESEND_API_KEY && env.FROM_EMAIL && env.OWNER_EMAIL),
      webhookUrl: `${site}/api/stripe/webhook`
    }
  });
}

async function adminRequestAction(request, env, id, action) {
  const req = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
  if (!req) return err("That request no longer exists.", 404);
  const t = nowISO();

  if (action === "approve") {
    if (!["pending", "expired"].includes(req.status)) return err(`This request is already ${req.status}.`);
    await syncFeeds(env); // re-check Airbnb/VRBO right now before holding the dates
    if (!(await isAvailable(env, req.check_in, req.check_out, { excludeRequestId: id }))) {
      return err("Those dates now overlap another booking or block. Decline the request or block different dates.", 409);
    }
    const holdMs = PRICING.holdHours * 3600 * 1000;
    const holdUntil = new Date(Date.now() + holdMs);
    let session = null;
    if (env.STRIPE_SECRET_KEY) {
      try { session = await createCheckout(env, req, Math.floor(holdUntil.getTime() / 1000)); }
      catch (e) { return err(`Stripe couldn't create the payment page: ${e.message}`, 502); }
    }
    await env.DB.prepare("UPDATE requests SET status = 'approved', updated_at = ?, hold_expires_at = ?, stripe_session_id = ?, payment_url = ? WHERE id = ?")
      .bind(t, holdUntil.toISOString(), session?.id || null, session?.url || null, id).run();
    const emailed = await sendEmail(env, req.email, `Your dates at ${PROPERTY.name} are approved`, [
      `Hi ${req.name},`,
      `Good news: ${req.check_in} to ${req.check_out} is available and we're holding it for you for ${PRICING.holdHours} hours.`,
      session ? `Pay ${money(req.total_cents)} securely here to confirm: ${session.url}` : `We'll be in touch shortly about payment of ${money(req.total_cents)}.`,
      "If payment isn't completed in time, the dates are released.",
      `— ${PROPERTY.name}`
    ]);
    return json({ ok: true, paymentUrl: session?.url || null, emailed: !!emailed.ok });
  }
  if (action === "decline") {
    if (req.status !== "pending") return err(`Only pending requests can be declined.`);
    await env.DB.prepare("UPDATE requests SET status = 'declined', updated_at = ? WHERE id = ?").bind(t, id).run();
    const body = await readJSON(request);
    await sendEmail(env, req.email, `About your request for ${PROPERTY.name}`, [
      `Hi ${req.name},`,
      `Unfortunately we can't host you from ${req.check_in} to ${req.check_out}.`,
      body?.message ? String(body.message).slice(0, 800) : "Feel free to request different dates on our website.",
      `— ${PROPERTY.name}`
    ]);
    return json({ ok: true });
  }
  if (action === "confirm") {
    // For payments collected outside Stripe (cash app, check, Zelle)
    if (!["approved", "expired", "pending"].includes(req.status)) return err(`This request is already ${req.status}.`);
    if (!(await isAvailable(env, req.check_in, req.check_out, { excludeRequestId: id }))) return err("Those dates overlap another booking or block.", 409);
    await env.DB.prepare("UPDATE requests SET status = 'confirmed', updated_at = ? WHERE id = ?").bind(t, id).run();
    await expireCheckout(env, req.stripe_session_id);
    return json({ ok: true });
  }
  if (action === "cancel") {
    if (!["approved", "confirmed"].includes(req.status)) return err("Only approved or confirmed bookings can be cancelled.");
    await env.DB.prepare("UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(t, id).run();
    await expireCheckout(env, req.stripe_session_id);
    return json({ ok: true, note: req.status === "confirmed" ? "Refund the guest from your Stripe dashboard if needed." : null });
  }
  return err("Unknown action.", 404);
}

async function adminAddBlock(request, env) {
  const b = await readJSON(request);
  if (!b || !isISODate(b.start) || !isISODate(b.end) || b.end <= b.start) return err("Pick a start date and an end date after it.");
  const id = newId("b_");
  await env.DB.prepare("INSERT INTO blocks (id, start_date, end_date, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, b.start, b.end, String(b.note || "").slice(0, 120), nowISO()).run();
  return json({ ok: true, id });
}

// ---------- Router ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;
    try {
      if (p === "/calendar.ics" && m === "GET") return calendarExport(request, env, url);
      if (p === "/api/property" && m === "GET") return apiProperty(env);
      if (p === "/api/availability" && m === "GET") return apiAvailability(env);
      if (p === "/api/quote" && m === "POST") return apiQuote(request, env);
      if (p === "/api/requests" && m === "POST") return apiCreateRequest(request, env);
      if (p === "/api/stripe/webhook" && m === "POST") return stripeWebhook(request, env);

      if (p === "/api/admin/login" && m === "POST") return adminLogin(request, env);
      if (p.startsWith("/api/admin/")) {
        const adminUser = await isAdmin(request, env);
        if (!adminUser) return err("Sign in again.", 401);
        if (m !== "GET" && !(request.headers.get("Content-Type") || "").includes("application/json")) return err("Bad request.", 415);
        if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSession() });
        if (p === "/api/admin/me" && m === "GET") return json({ user: adminUser });
        if (p === "/api/admin/overview" && m === "GET") return adminOverview(env, url, adminUser);
        if (p === "/api/admin/sync" && m === "POST") return json({ results: await syncFeeds(env) });
        if (p === "/api/admin/blocks" && m === "POST") return adminAddBlock(request, env);
        let mm = /^\/api\/admin\/blocks\/([\w-]+)$/.exec(p);
        if (mm && m === "DELETE") { await env.DB.prepare("DELETE FROM blocks WHERE id = ?").bind(mm[1]).run(); return json({ ok: true }); }
        if (p === "/api/admin/finance" && m === "GET") return json(await buildForecast(env));
        if (p === "/api/admin/finance/settings" && m === "POST") {
          const r = await saveSettings(env, (await readJSON(request)) || {});
          return r.ok ? json(r) : err(r.error);
        }
        if (p === "/api/admin/finance/booking" && m === "POST") {
          const r = await saveBookingNote(env, await readJSON(request));
          return r.ok ? json(r) : err(r.error);
        }
        if (p === "/api/admin/finance/stays" && m === "POST") {
          const r = parseManualStay(await readJSON(request));
          if (!r.ok) return err(r.error);
          const st = r.stay, id = newId("s_");
          await env.DB.prepare("INSERT INTO stays_manual (id, guest, check_in, check_out, channel, host_payout_cents, cleaning_cents, taxes_cents, statement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, st.guest, st.checkIn, st.checkOut, st.channel, st.host, st.cleaning, st.taxes, st.statement, nowISO()).run();
          return json({ ok: true, id });
        }
        mm = /^\/api\/admin\/finance\/stays\/([\w-]+)$/.exec(p);
        if (mm && m === "DELETE") { await env.DB.prepare("DELETE FROM stays_manual WHERE id = ?").bind(mm[1]).run(); return json({ ok: true }); }
        if (p === "/api/admin/expenses" && m === "POST") {
          const r = parseExpense(await readJSON(request));
          if (!r.ok) return err(r.error);
          const id = newId("e_");
          await env.DB.prepare("INSERT INTO expenses (id, name, amount_cents, kind, start_month, end_month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(id, r.expense.name, r.expense.amountCents, r.expense.kind, r.expense.start, r.expense.end, nowISO()).run();
          return json({ ok: true, id });
        }
        mm = /^\/api\/admin\/expenses\/([\w-]+)$/.exec(p);
        if (mm && m === "DELETE") { await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(mm[1]).run(); return json({ ok: true }); }
        mm = /^\/api\/admin\/requests\/([\w-]+)\/(approve|decline|confirm|cancel)$/.exec(p);
        if (mm && m === "POST") return adminRequestAction(request, env, mm[1], mm[2]);
      }
      if (p.startsWith("/api/")) return err("Not found.", 404);
      const asset = await env.ASSETS.fetch(request);
      if (env.ENVIRONMENT !== "staging") return asset;
      // Keep the test site out of search engines
      const res = new Response(asset.body, asset);
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
      return res;
    } catch (e) {
      console.error(e);
      return err("Something went wrong on our side. Try again in a minute.", 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await syncFeeds(env);
      // release dates from approved requests that were never paid
      await env.DB.prepare("UPDATE requests SET status = 'expired', updated_at = ? WHERE status = 'approved' AND hold_expires_at < ?")
        .bind(nowISO(), nowISO()).run();
    })());
  }
};
