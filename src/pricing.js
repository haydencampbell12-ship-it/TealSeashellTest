import { PRICING, PROPERTY } from "./config.js";
import { diffDays, eachNight, isISODate, month, todayLocal, addDays } from "./dates.js";

const cents = (n) => Math.round(n * 100);
const pad = (n) => String(n).padStart(2, "0");
const md = (date) => date.slice(5);
const dow = (date) => new Date(date + "T00:00:00Z").getUTCDay();

// ---- Holiday anchors that move every year ----
function nthWeekday(year, monthIdx, weekday, n) { // n = 1..5, or -1 for last
  if (n > 0) {
    const first = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
    return Date.UTC(year, monthIdx, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(Date.UTC(year, monthIdx + 1, 0));
  return Date.UTC(year, monthIdx, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}
function easter(year) { // Anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mon = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, mon - 1, day);
}
const ANCHORS = {
  easter: (y) => easter(y),
  memorialDay: (y) => nthWeekday(y, 4, 1, -1),
  laborDay: (y) => nthWeekday(y, 8, 1, 1),
  thanksgiving: (y) => nthWeekday(y, 10, 4, 4)
};
const isoUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

// Concrete [start, end) date ranges for every holiday in a given year
const holidayCache = new Map();
export function holidaysForYear(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const out = [];
  for (const h of PRICING.holidays) {
    let start, end;
    if (h.anchor) {
      const base = isoUTC(ANCHORS[h.anchor](year));
      start = addDays(base, h.from); end = addDays(base, h.to);
    } else {
      start = `${year}-${h.start}`;
      end = h.end > h.start ? `${year}-${h.end}` : `${year + 1}-${h.end}`; // wraps into January
    }
    out.push({ ...h, start, end, nightly: Math.max(h.nightly, PRICING.nightlyFloor) });
  }
  holidayCache.set(year, out);
  return out;
}

function holidayFor(date) {
  const y = Number(date.slice(0, 4));
  let best = null;
  for (const h of [...holidaysForYear(y - 1), ...holidaysForYear(y)]) {
    if (date >= h.start && date < h.end && (!best || h.nightly > best.nightly)) best = h;
  }
  return best;
}

function seasonFor(date) {
  const d = md(date);
  return PRICING.seasons.find((s) => d >= s.start && d < s.end) || PRICING.seasons[0];
}

// The price of one night and why
export function nightRate(date) {
  const h = holidayFor(date);
  if (h) return { price: h.nightly, label: h.name, minNights: h.minNights };
  const s = seasonFor(date);
  let price = Math.max(s.nightly, PRICING.nightlyFloor);
  let label = s.name;
  if (PRICING.weekend.nights.includes(dow(date))) {
    price = Math.round(price * (1 + PRICING.weekend.percent / 100));
    label = `${s.name} weekend`;
  }
  return { price, label, minNights: s.minNights };
}

// Upcoming holiday dates, for the rates table on the website
export function upcomingHolidays(fromDate, days = 400) {
  const until = addDays(fromDate, days);
  const y = Number(fromDate.slice(0, 4));
  return [...holidaysForYear(y), ...holidaysForYear(y + 1)]
    .filter((h) => h.end > fromDate && h.start < until)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map(({ name, start, end, nightly, minNights }) => ({ name, start, end, nightly, minNights }));
}

// Returns { ok: true, quote } or { ok: false, error }
export function buildQuote(checkIn, checkOut, guests) {
  if (!isISODate(checkIn) || !isISODate(checkOut)) return { ok: false, error: "Choose a check-in and check-out date." };
  const today = todayLocal();
  if (checkIn < today) return { ok: false, error: "Check-in can't be in the past." };
  if (checkIn > addDays(today, PRICING.bookingWindowDays)) return { ok: false, error: "That date is further out than we take bookings. Send us a message instead." };
  const nights = diffDays(checkIn, checkOut);
  if (nights < 1) return { ok: false, error: "Check-out must be after check-in." };
  if (nights > PRICING.maxNights) return { ok: false, error: `Stays are limited to ${PRICING.maxNights} nights. Contact us for longer stays.` };
  const g = Number(guests || 1);
  if (!Number.isInteger(g) || g < 1 || g > PROPERTY.maxGuests) return { ok: false, error: `The studio sleeps up to ${PROPERTY.maxGuests} guests.` };

  const m = PRICING.monthly;
  const isMonthly = nights >= m.minNights && m.months.includes(month(checkIn));
  const first = nightRate(checkIn);
  if (!isMonthly && nights < first.minNights) {
    return { ok: false, error: `${first.label} stays need at least ${first.minNights} nights.` };
  }

  const lines = [];
  let lodgingCents;
  if (isMonthly) {
    lodgingCents = cents((m.perMonth / 30) * nights);
    lines.push({ label: `Snowbird monthly rate, ${nights} nights`, cents: lodgingCents });
  } else {
    // Group nights with the same rate and reason for a readable breakdown
    const groups = [];
    for (const night of eachNight(checkIn, checkOut)) {
      const r = nightRate(night);
      const key = r.label + "|" + r.price;
      const last = groups.find((gp) => gp.key === key);
      if (last) last.count++; else groups.push({ key, ...r, count: 1 });
    }
    lodgingCents = 0;
    for (const gp of groups) {
      const c = cents(gp.price * gp.count);
      lodgingCents += c;
      lines.push({ label: `$${gp.price} × ${gp.count} night${gp.count > 1 ? "s" : ""} (${gp.label})`, cents: c });
    }
    if (nights >= PRICING.weeklyDiscount.minNights) {
      // The discount never takes the average night below the floor
      const maxOff = lodgingCents - cents(PRICING.nightlyFloor * nights);
      const d = Math.min(Math.round(lodgingCents * PRICING.weeklyDiscount.percent / 100), Math.max(0, maxOff));
      if (d > 0) {
        lines.push({ label: d < Math.round(lodgingCents * PRICING.weeklyDiscount.percent / 100) ? "Weekly discount" : `Weekly discount (${PRICING.weeklyDiscount.percent}%)`, cents: -d });
        lodgingCents -= d;
      }
    }
  }
  const cleaningCents = cents(PRICING.cleaningFee);
  lines.push({ label: "Cleaning fee", cents: cleaningCents });
  const taxCents = Math.round((lodgingCents + cleaningCents) * PRICING.taxRate);
  lines.push({ label: "Florida & Bay County lodging taxes", cents: taxCents });
  const totalCents = lodgingCents + cleaningCents + taxCents;
  const airbnbEstimateCents = Math.round(totalCents + (lodgingCents + cleaningCents) * PRICING.airbnbGuestFeeEstimate);

  return {
    ok: true,
    quote: { checkIn, checkOut, nights, guests: g, monthly: isMonthly, lines, totalCents, savingsCents: airbnbEstimateCents - totalCents }
  };
}
