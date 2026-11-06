// Revenue and expense forecast for the owner dashboard.
//
// Money works the way your management statements do:
//   host payout − cleaning − city & county taxes − management fee = owner payout
// and each stay is counted in the month it pays out (the day after check-in).
// Occupancy is still counted night by night.
import { PRICING } from "./config.js";
import { nightRate } from "./pricing.js";
import { addDays, eachNight, overlaps, todayLocal, isISODate } from "./dates.js";

export const DEFAULT_SETTINGS = {
  airbnbFeePct: 3,           // Airbnb split-fee host fee. Use 15.5 if you're on host-only pricing.
  vrboFeePct: 12,            // VRBO pay-per-booking commission (from Oct 29, 2026)
  stripePct: 2.9,            // Stripe card fee on direct bookings
  stripeFixedCents: 30,
  cleaningCostCents: 12500,  // cleaning charged per stay on your statements
  localTaxPct: 6.69,         // city & county taxes, as a share of host payout (from your Jul–Oct statements)
  managementFeePct: 20,      // former property manager's share of host payout after cleaning and taxes
  selfManagedFrom: "2026-11-01", // stays paying out on or after this date have no management fee
  occupancyTarget: 50,
  monthsBack: 4,
  monthsAhead: 12
};
const CHANNELS = ["direct", "airbnb", "vrbo", "managed"];

export async function getSettings(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'finance_settings'").first();
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
}

export async function saveSettings(env, patch) {
  const next = { ...(await getSettings(env)) };
  const rules = {
    airbnbFeePct: [0, 30], vrboFeePct: [0, 30], stripePct: [0, 10], stripeFixedCents: [0, 500],
    cleaningCostCents: [0, 100000], localTaxPct: [0, 30], managementFeePct: [0, 60],
    occupancyTarget: [1, 100], monthsBack: [0, 24], monthsAhead: [1, 24]
  };
  for (const [k, [lo, hi]] of Object.entries(rules)) {
    if (patch[k] === undefined) continue;
    const v = Number(patch[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) return { ok: false, error: `That setting must be between ${lo} and ${hi}.` };
    next[k] = ["monthsBack", "monthsAhead", "stripeFixedCents", "cleaningCostCents"].includes(k) ? Math.round(v) : v;
  }
  if (patch.selfManagedFrom !== undefined) {
    if (!isISODate(patch.selfManagedFrom)) return { ok: false, error: "Pick the date you started managing the studio yourself." };
    next.selfManagedFrom = patch.selfManagedFrom;
  }
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('finance_settings', ?)").bind(JSON.stringify(next)).run();
  return { ok: true, settings: next };
}

const monthKey = (d) => d.slice(0, 7);
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const daysInMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const payoutMonth = (checkIn) => monthKey(addDays(checkIn, 1));

// Calendar entries that are blocks, not guests — e.g. Airbnb shows VRBO stays as "Airbnb (Not available)"
export function looksLikeBooking(summary) {
  return !/not available|unavailable|blocked|closed/i.test(summary || "");
}
const taxFromQuote = (q) => (q.lines || []).find((l) => /tax/i.test(l.label))?.cents || 0;

// Split a host payout into cleaning, taxes, management and what's left for you.
// The management fee only applies to stays that paid out while the studio had a manager.
function settle(s, hostPayout, cleaning, taxes, checkIn) {
  const base = hostPayout - cleaning - taxes;
  const managed = addDays(checkIn, 1) < s.selfManagedFrom;
  const mgmt = managed ? Math.round(base * s.managementFeePct / 100) : 0;
  return { cleaningCents: cleaning, taxesCents: taxes, mgmtCents: mgmt, ownerCents: base - mgmt };
}

export async function buildForecast(env) {
  const s = await getSettings(env);
  const today = todayLocal();
  const firstMonth = addMonths(monthKey(today), -s.monthsBack);
  const lastMonth = addMonths(monthKey(today), s.monthsAhead - 1);
  const rangeStart = addDays(`${firstMonth}-01`, -1);
  const rangeEnd = `${addMonths(lastMonth, 1)}-01`;

  const [direct, pipeline, ext, notes, manual, expenses] = await Promise.all([
    env.DB.prepare("SELECT * FROM requests WHERE status = 'confirmed' AND check_out > ? AND check_in < ?").bind(rangeStart, rangeEnd).all(),
    env.DB.prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total FROM requests WHERE status IN ('pending','approved') AND check_out > ? GROUP BY status").bind(today).all(),
    env.DB.prepare("SELECT source, uid, start_date, end_date, summary FROM ext_events WHERE end_date > ? AND start_date < ?").bind(rangeStart, rangeEnd).all(),
    env.DB.prepare("SELECT * FROM ext_payouts").all(),
    env.DB.prepare("SELECT * FROM stays_manual WHERE check_out > ? AND check_in < ? ORDER BY check_in").bind(rangeStart, rangeEnd).all(),
    env.DB.prepare("SELECT * FROM expenses ORDER BY kind, start_month").all()
  ]);
  const noteMap = new Map(notes.results.map((n) => [`${n.source}|${n.uid}`, n]));

  const stays = [];
  // Stays entered from statements are the real numbers
  for (const m of manual.results) {
    stays.push({
      key: `manual|${m.id}`, id: m.id, channel: m.channel, guest: m.guest, checkIn: m.check_in, checkOut: m.check_out,
      nights: eachNight(m.check_in, m.check_out).length, guestPaidCents: null, platformFeesCents: null,
      hostPayoutCents: m.host_payout_cents, ...settle(s, m.host_payout_cents, m.cleaning_cents, m.taxes_cents, m.check_in),
      basis: m.statement || "Entered by hand", estimated: false, isBooking: true, manual: true
    });
  }
  const coveredByManual = (a, b) => manual.results.some((m) => overlaps(a, b, m.check_in, m.check_out));

  for (const r of direct.results) {
    const q = JSON.parse(r.quote_json);
    const tax = taxFromQuote(q);
    const fee = r.stripe_session_id ? Math.round(r.total_cents * s.stripePct / 100) + s.stripeFixedCents : 0;
    const host = r.total_cents - fee;
    stays.push({
      key: `direct|${r.id}`, id: r.id, channel: "direct", guest: r.name, guests: r.guests,
      checkIn: r.check_in, checkOut: r.check_out, nights: r.nights,
      guestPaidCents: r.total_cents, platformFeesCents: fee, hostPayoutCents: host,
      ...settle(s, host, s.cleaningCostCents, tax, r.check_in),
      basis: r.stripe_session_id ? "Paid by card" : "Paid offline", estimated: false, isBooking: true
    });
  }

  for (const e of ext.results) {
    if (coveredByManual(e.start_date, e.end_date)) continue; // already on a statement
    const note = noteMap.get(`${e.source}|${e.uid}`);
    const isBooking = note && note.is_booking !== null && note.is_booking !== undefined ? !!note.is_booking : looksLikeBooking(e.summary);
    const pct = e.source === "airbnb" ? s.airbnbFeePct : s.vrboFeePct;
    let guestPaid, fees, host, estimated;
    if (note && note.payout_cents !== null && note.payout_cents !== undefined) {
      host = note.payout_cents;
      guestPaid = Math.round(host / (1 - pct / 100)); fees = guestPaid - host; estimated = false;
    } else {
      // Estimate from your own rate card: nightly rates + the cleaning fee the guest pays
      guestPaid = eachNight(e.start_date, e.end_date).reduce((t, d) => t + nightRate(d).price * 100, 0) + PRICING.cleaningFee * 100;
      fees = Math.round(guestPaid * pct / 100); host = guestPaid - fees; estimated = true;
    }
    stays.push({
      key: `${e.source}|${e.uid}`, uid: e.uid, channel: e.source, guest: note?.guest || "", calendarLabel: e.summary || "",
      checkIn: e.start_date, checkOut: e.end_date, nights: eachNight(e.start_date, e.end_date).length,
      guestPaidCents: guestPaid, platformFeesCents: fees, hostPayoutCents: host,
      ...settle(s, host, s.cleaningCostCents, Math.round(host * s.localTaxPct / 100), e.start_date),
      basis: estimated ? "Estimated from your rates" : "Payout entered", estimated, isBooking, note: note?.note || ""
    });
  }
  stays.sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));

  // ---- months ----
  const months = [];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) {
    months.push({
      month: m, days: daysInMonth(m), past: m < monthKey(today), current: m === monthKey(today),
      nights: Object.fromEntries(CHANNELS.map((c) => [c, 0])),
      hostCents: Object.fromEntries(CHANNELS.map((c) => [c, 0])),
      cleaningCents: 0, taxesCents: 0, mgmtCents: 0, ownerCents: 0, expenseCents: 0, stays: 0, estimatedStays: 0
    });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const b of stays) {
    if (!b.isBooking) continue;
    for (const night of eachNight(b.checkIn, b.checkOut)) { const mm = byMonth.get(monthKey(night)); if (mm) mm.nights[b.channel] += 1; }
    const mm = byMonth.get(payoutMonth(b.checkIn));
    if (!mm) continue;
    mm.hostCents[b.channel] += b.hostPayoutCents;
    mm.cleaningCents += b.cleaningCents; mm.taxesCents += b.taxesCents; mm.mgmtCents += b.mgmtCents; mm.ownerCents += b.ownerCents;
    mm.stays += 1; if (b.estimated) mm.estimatedStays += 1;
  }
  for (const ex of expenses.results) {
    for (const mm of months) {
      const active = ex.kind === "once" ? mm.month === ex.start_month : mm.month >= ex.start_month && (!ex.end_month || mm.month <= ex.end_month);
      if (active) mm.expenseCents += ex.amount_cents;
    }
  }
  for (const mm of months) {
    mm.bookedNights = CHANNELS.reduce((t, c) => t + mm.nights[c], 0);
    mm.occupancy = Math.round((mm.bookedNights / mm.days) * 1000) / 10;
    mm.hostTotalCents = CHANNELS.reduce((t, c) => t + mm.hostCents[c], 0);
    mm.netCents = mm.ownerCents - mm.expenseCents;
  }

  // ---- Projection: fill each future month's open nights up to the occupancy target ----
  // Priced from your rate card, booked through Airbnb, with cleaning, taxes and no management fee.
  const bookedNightSet = new Set();
  for (const b of stays) if (b.isBooking) for (const n of eachNight(b.checkIn, b.checkOut)) bookedNightSet.add(n);
  const histStays = stays.filter((b) => b.isBooking && b.checkOut <= today);
  const avgStay = histStays.length ? histStays.reduce((t, b) => t + b.nights, 0) / histStays.length : 4;
  for (const mm of months) {
    mm.projected = { nights: 0, stays: 0, hostCents: 0, cleaningCents: 0, taxesCents: 0, ownerCents: 0 };
    if (mm.past) continue;
    const open = [];
    for (let d = `${mm.month}-01`; monthKey(d) === mm.month; d = addDays(d, 1)) if (d >= today && !bookedNightSet.has(d)) open.push(d);
    const want = Math.round(mm.days * s.occupancyTarget / 100) - mm.bookedNights;
    const n = Math.max(0, Math.min(open.length, want));
    if (!n) continue;
    const avgRate = open.reduce((t, d) => t + nightRate(d).price, 0) / open.length;
    const projStays = Math.max(1, Math.round(n / avgStay));
    const guestPaid = Math.round(avgRate * n * 100) + projStays * PRICING.cleaningFee * 100;
    const host = guestPaid - Math.round(guestPaid * s.airbnbFeePct / 100);
    const taxes = Math.round(host * s.localTaxPct / 100);
    const cleaning = projStays * s.cleaningCostCents;
    mm.projected = { nights: n, stays: projStays, hostCents: host, cleaningCents: cleaning, taxesCents: taxes, ownerCents: host - cleaning - taxes, avgRate: Math.round(avgRate) };
  }
  for (const mm of months) {
    const p = mm.projected;
    mm.withProjection = {
      bookedNights: mm.bookedNights + p.nights,
      occupancy: Math.round(((mm.bookedNights + p.nights) / mm.days) * 1000) / 10,
      hostTotalCents: mm.hostTotalCents + p.hostCents, cleaningCents: mm.cleaningCents + p.cleaningCents, taxesCents: mm.taxesCents + p.taxesCents,
      mgmtCents: mm.mgmtCents, ownerCents: mm.ownerCents + p.ownerCents, expenseCents: mm.expenseCents,
      netCents: mm.ownerCents + p.ownerCents - mm.expenseCents
    };
  }

  const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const roll = (arr) => {
    const t = {
      hostCents: sum(arr, (m) => m.hostTotalCents), cleaningCents: sum(arr, (m) => m.cleaningCents), taxesCents: sum(arr, (m) => m.taxesCents),
      mgmtCents: sum(arr, (m) => m.mgmtCents), ownerCents: sum(arr, (m) => m.ownerCents), expenseCents: sum(arr, (m) => m.expenseCents),
      netCents: sum(arr, (m) => m.netCents), bookedNights: sum(arr, (m) => m.bookedNights), days: sum(arr, (m) => m.days), stays: sum(arr, (m) => m.stays),
      byChannel: Object.fromEntries(CHANNELS.map((c) => [c, sum(arr, (m) => m.hostCents[c])]))
    };
    t.occupancy = t.days ? Math.round((t.bookedNights / t.days) * 1000) / 10 : 0;
    return t;
  };
  const ahead = months.filter((m) => !m.past);
  const past = months.filter((m) => m.past);
  const totals = roll(ahead);
  const history = roll(past);
  const wp = (f) => sum(ahead, (m) => f(m.withProjection));
  totals.withProjection = {
    hostCents: wp((x) => x.hostTotalCents), cleaningCents: wp((x) => x.cleaningCents), taxesCents: wp((x) => x.taxesCents),
    mgmtCents: wp((x) => x.mgmtCents), ownerCents: wp((x) => x.ownerCents), expenseCents: wp((x) => x.expenseCents), netCents: wp((x) => x.netCents),
    bookedNights: wp((x) => x.bookedNights), days: totals.days, projectedNights: sum(ahead, (m) => m.projected.nights), projectedOwnerCents: sum(ahead, (m) => m.projected.ownerCents)
  };
  totals.withProjection.occupancy = totals.days ? Math.round((totals.withProjection.bookedNights / totals.days) * 1000) / 10 : 0;

  // What hitting the occupancy target would earn: your actual payout per booked night,
  // with the management fee added back now that you manage the studio yourself
  const ref = history.bookedNights ? history : totals;
  const perNight = ref.bookedNights ? (ref.ownerCents + ref.mgmtCents) / ref.bookedNights : 0;
  const managedMonths = past.filter((m) => m.mgmtCents > 0).length;
  totals.mgmtSavedPerMonthCents = managedMonths ? Math.round(history.mgmtCents / managedMonths) : 0;
  const targetNights = Math.round(totals.days * s.occupancyTarget / 100);
  totals.atTarget = { nights: targetNights, ownerCents: Math.round(perNight * targetNights), netCents: Math.round(perNight * targetNights) - totals.expenseCents, perNightCents: Math.round(perNight) };

  const pipe = Object.fromEntries(pipeline.results.map((p) => [p.status, { count: p.n, totalCents: p.total }]));
  return {
    today, settings: s, months, totals, history, stays,
    pipeline: { pending: pipe.pending || { count: 0, totalCents: 0 }, approved: pipe.approved || { count: 0, totalCents: 0 } },
    expenses: expenses.results
  };
}

export async function saveBookingNote(env, body) {
  const source = body?.source;
  const uid = String(body?.uid || "");
  if (!["airbnb", "vrbo"].includes(source) || !uid) return { ok: false, error: "Pick an Airbnb or VRBO reservation." };
  let payout = null;
  if (body.payout !== null && body.payout !== undefined && body.payout !== "") {
    const n = Number(body.payout);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "Enter the host payout in dollars, like 845.50." };
    payout = Math.round(n * 100);
  }
  const isBooking = body.isBooking === true ? 1 : body.isBooking === false ? 0 : null;
  await env.DB.prepare(`INSERT INTO ext_payouts (source, uid, guest, payout_cents, note, is_booking, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, uid) DO UPDATE SET guest = excluded.guest, payout_cents = excluded.payout_cents, note = excluded.note, is_booking = excluded.is_booking, updated_at = excluded.updated_at`)
    .bind(source, uid, String(body.guest || "").slice(0, 80), payout, String(body.note || "").slice(0, 200), isBooking, new Date().toISOString()).run();
  return { ok: true };
}

// A stay copied from a management statement
export function parseManualStay(body) {
  const guest = String(body?.guest || "").trim().slice(0, 80);
  const channel = ["managed", "airbnb", "vrbo", "other"].includes(body?.channel) ? body.channel : "managed";
  const money = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) : null; };
  const host = money(body?.hostPayout), cleaning = money(body?.cleaning ?? 0), taxes = money(body?.taxes ?? 0);
  if (!guest) return { ok: false, error: "Add the guest's name." };
  if (!isISODate(body?.checkIn) || !isISODate(body?.checkOut) || body.checkOut <= body.checkIn) return { ok: false, error: "Pick a check-in date and a later check-out date." };
  if (host === null || cleaning === null || taxes === null) return { ok: false, error: "Enter the host payout, cleaning fee and taxes in dollars, as they appear on the statement." };
  return { ok: true, stay: { guest, channel, checkIn: body.checkIn, checkOut: body.checkOut, host, cleaning, taxes, statement: String(body?.statement || "").slice(0, 60) || null } };
}
