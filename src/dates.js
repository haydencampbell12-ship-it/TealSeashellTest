// Date helpers. All dates are "YYYY-MM-DD" strings treated as calendar days in UTC.
const DAY = 86400000;

export function isISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export function toDate(s) { return new Date(s + "T00:00:00Z"); }
export function fmt(d) { return d.toISOString().slice(0, 10); }
export function addDays(s, n) { return fmt(new Date(toDate(s).getTime() + n * DAY)); }
export function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
export function month(s) { return Number(s.slice(5, 7)); }

// "Today" in Panama City Beach (America/Chicago)
export function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

// Ranges are [start, end) — the checkout day is free for the next check-in.
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function eachNight(start, end) {
  const out = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}
