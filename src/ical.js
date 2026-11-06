import { addDays, fmt, isISODate } from "./dates.js";

// ---- Import: parse an Airbnb / VRBO iCal feed into date ranges ----
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function icsDate(value) {
  // Accepts 20261110, 20261110T150000, 20261110T150000Z
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || "");
  if (!m) return null;
  const s = `${m[1]}-${m[2]}-${m[3]}`;
  return isISODate(s) ? s : null;
}

export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const raw of unfold(text).split("\n")) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start) {
        const end = cur.end && cur.end > cur.start ? cur.end : addDays(cur.start, 1);
        events.push({ uid: cur.uid || `${cur.start}_${end}`, start: cur.start, end, summary: (cur.summary || "").slice(0, 120) });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const val = line.slice(idx + 1);
    if (key === "DTSTART") cur.start = icsDate(val);
    else if (key === "DTEND") cur.end = icsDate(val);
    else if (key === "UID") cur.uid = val.slice(0, 200);
    else if (key === "SUMMARY") cur.summary = val;
  }
  return events;
}

export async function syncFeeds(env) {
  const feeds = [["airbnb", env.AIRBNB_ICAL_URL], ["vrbo", env.VRBO_ICAL_URL]];
  const results = {};
  for (const [source, url] of feeds) {
    if (!url) { results[source] = { ok: false, skipped: true }; continue; }
    try {
      const res = await fetch(url, { headers: { "User-Agent": "TealSeashell-CalendarSync/1.0" }, cf: { cacheTtl: 0 } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Not a calendar feed");
      const events = parseICS(text);
      // Keep past stays for revenue history; replace everything from today on
      const today = new Date().toISOString().slice(0, 10);
      const stmts = [env.DB.prepare("DELETE FROM ext_events WHERE source = ? AND end_date >= ?").bind(source, today)];
      for (const e of events.filter((ev) => ev.end >= today)) {
        stmts.push(env.DB.prepare("INSERT OR REPLACE INTO ext_events (source, uid, start_date, end_date, summary) VALUES (?, ?, ?, ?, ?)")
          .bind(source, e.uid, e.start, e.end, e.summary));
      }
      await env.DB.batch(stmts);
      results[source] = { ok: true, events: events.length, at: new Date().toISOString() };
    } catch (err) {
      // Keep the last good import if a fetch fails
      results[source] = { ok: false, error: String(err.message || err), at: new Date().toISOString() };
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)").bind(JSON.stringify(results)).run();
  return results;
}

// ---- Export: direct bookings + owner blocks for Airbnb / VRBO to import ----
function esc(s) { return String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n"); }
const ymd = (s) => s.replace(/-/g, "");

export function buildICS(ranges, siteHost) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Teal Seashell//Direct Bookings//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:The Teal Seashell – direct"
  ];
  for (const r of ranges) {
    lines.push("BEGIN:VEVENT",
      `UID:${r.uid}@${siteHost}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(r.start)}`,
      `DTEND;VALUE=DATE:${ymd(r.end)}`,
      `SUMMARY:${esc(r.summary || "Not available")}`,
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
