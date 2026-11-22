// Day-before-arrival message for direct bookings.
//
// The template is edited on the dashboard's Setup tab and stored in the database, never in
// this repo, because it holds door, gate and Wi-Fi codes and the repo is public.
// Placeholders such as {first_name} are filled in for each booking.
import { PROPERTY } from "./config.js";
import { addDays, todayLocal } from "./dates.js";
import { sendEmail } from "./email.js";
import { sendPush, shortDate } from "./notify.js";

// Starting point shown on the Setup tab. Codes are left as [BRACKETS] for the owner to fill in.
export const DEFAULT_TEMPLATE = `Hi {first_name},

Thank you for booking with us! We are excited to host you. Here is everything needed to get checked in and settled:

Unit 219 - The Teal Seashell at Fontainebleau Terrace 🏖️

Your code will be activated at {check_in_time} for check-in on {check_in_date}. You just go straight to the unit to check in, as there is no front desk.

There is a parking pass and 2 armbands in the unit for you, and you can park in any available parking space in the parking lot of Fontainebleau Terrace. Fontainebleau Terrace also now owns the Dollar Store property across the street, so if the building's parking lot is full, you can also park in this parking lot with a parking pass. There is also overflow parking along the road by the beach to the east side of the building that you can use as well.

The elevator is located in the hallway off of the drive-through area under the building, so you can pull there and park temporarily to unload any luggage. Luggage carts are in the elevator hallway, tucked in at the base of the stairs.

There is welcome and informational signage on the refrigerator in the unit, as well as important beach safety information on the back of the entry door. Please take a few moments once you're settled to read through the info on the back of the door.

Door code to Unit 219: {door_code} ✅
Enter the door code, then touch the check button in the bottom right-hand corner. To lock the door, press and hold the check button for several seconds. The door will auto-lock after 1 minute if not locked manually, but please make sure the door is fully closed so the lock does not jam.

Gate code: [GATE CODE] - This code opens the pool, the ground-floor covered terrace, the beach access gate and the ground-level bathroom.
Owner's lounge (fitness area, 5th floor): [LOUNGE CODE]

Wi-Fi network: [WI-FI NETWORK]
Wi-Fi password: [WI-FI PASSWORD]

Guest laundry is on the 2nd floor in the elevator hallway. It should be $2.75 to wash and $2.50 to dry, and the machines take cards.

Check-out is by {check_out_time} on {check_out_date}. Before you go:
{checkout_steps}

Please let us know if you need anything. It is important to us that you have a 5-star experience, so please reach out if anything needs our attention. We hope you have a wonderful stay! 🏖️`;

export const PLACEHOLDERS = {
  "{first_name}": "Guest's first name",
  "{check_in_date}": "e.g. Monday, November 2nd",
  "{check_in_time}": `Check-in time (${PROPERTY.checkInTime})`,
  "{check_out_date}": "e.g. Friday, November 6th",
  "{check_out_time}": `Check-out time (${PROPERTY.checkOutTime})`,
  "{nights}": "Number of nights",
  "{door_code}": "This guest's unit door code, entered on their booking",
  "{checkout_steps}": "Your check-out checklist, numbered"
};

const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
// "2026-11-02" -> "Monday, November 2nd"
export function longDate(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const mo = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${wd}, ${mo} ${ordinal(d.getUTCDate())}`;
}

export function render(template, booking) {
  const first = String(booking.name || "").trim().split(/\s+/)[0] || "there";
  const values = {
    "{first_name}": first,
    "{check_in_date}": longDate(booking.check_in),
    "{check_in_time}": PROPERTY.checkInTime.replace(":00", "").replace(" ", "").toLowerCase(), // "4pm"
    "{check_out_date}": longDate(booking.check_out),
    "{check_out_time}": PROPERTY.checkOutTime.replace(":00", "").replace(" ", "").toLowerCase(), // "10am"
    "{nights}": String(booking.nights),
    "{door_code}": booking.door_code || "[DOOR CODE]",
    "{checkout_steps}": (PROPERTY.checkoutSteps || []).map((s, i) => `${i + 1}. ${s}`).join("\n")
  };
  let text = template;
  for (const [k, v] of Object.entries(values)) text = text.split(k).join(v);
  return { subject: `Check-in details for ${PROPERTY.name}: ${longDate(booking.check_in)}`, text };
}

export async function getArrival(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'arrival_settings'").first();
  const saved = row ? JSON.parse(row.value) : {};
  return { enabled: !!saved.enabled, template: saved.template || DEFAULT_TEMPLATE, customized: !!saved.template };
}

export async function saveArrival(env, body) {
  const template = String(body?.template ?? "").replace(/\r\n/g, "\n").trim();
  if (template.length < 20) return { ok: false, error: "The message is empty. Paste your check-in guide first." };
  if (template.length > 12000) return { ok: false, error: "That message is too long. Keep it under 12,000 characters." };
  const enabled = !!body?.enabled;
  if (enabled && /\[[A-Z][A-Z \-]+\]/.test(template)) return { ok: false, error: "Fill in every [BRACKETED] code before turning automatic sending on." };
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('arrival_settings', ?)").bind(JSON.stringify({ enabled, template })).run();
  return { ok: true, settings: { enabled, template, customized: true } };
}

export const needsDoorCode = (template) => template.includes("{door_code}");
export async function getDoorCode(env, id) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(`door_code:${id}`).first();
  return row ? row.value : "";
}
export async function saveDoorCode(env, id, code) {
  code = String(code ?? "").trim();
  if (code && !/^[0-9A-Za-z#*\- ]{3,20}$/.test(code)) return { ok: false, error: "Door codes can be 3 to 20 letters or numbers." };
  if (code) await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(`door_code:${id}`, code).run();
  else await env.DB.prepare("DELETE FROM meta WHERE key = ?").bind(`door_code:${id}`).run();
  return { ok: true, code };
}

export const emailReady = (env) => !!(env.RESEND_API_KEY && env.FROM_EMAIL);

// Hour of the day in Panama City Beach
function localHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

// Runs from the cron every 30 minutes. From 9 AM Central the day before check-in, emails each confirmed
// direct guest once (or, for a same-day booking, as soon as it's confirmed). If email isn't set up yet,
// it pushes the owner a reminder to copy the message from the dashboard instead.
export async function sendArrivalMessages(env) {
  const settings = await getArrival(env);
  if (!settings.enabled || localHour() < 9) return { skipped: true };
  const today = todayLocal(), tomorrow = addDays(today, 1);
  const due = await env.DB.prepare("SELECT * FROM requests WHERE status = 'confirmed' AND check_in IN (?, ?)").bind(today, tomorrow).all();
  const results = [];
  for (const r of due.results) {
    const sentKey = `arrival_sent:${r.id}`, nudgeKey = `arrival_nudge:${r.id}`;
    if (await env.DB.prepare("SELECT 1 FROM meta WHERE key = ?").bind(sentKey).first()) continue;
    r.door_code = await getDoorCode(env, r.id);
    if (needsDoorCode(settings.template) && !r.door_code) {
      // Don't send a message with a blank code. Remind the owner once, then send as soon as the code is added.
      const codeKey = `arrival_code_nudge:${r.id}`;
      if (!(await env.DB.prepare("SELECT 1 FROM meta WHERE key = ?").bind(codeKey).first())) {
        await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(codeKey, new Date().toISOString()).run();
        await sendPush(env, { title: `Add a door code: ${r.name}`, message: `${r.name} arrives ${shortDate(r.check_in)}. Add their unit door code on the booking in your dashboard and the check-in message will go out right after.`, tags: ["key"], priority: 4, path: "/admin.html" });
      }
      results.push({ id: r.id, waitingForCode: true });
      continue;
    }
    const msg = render(settings.template, r);
    if (emailReady(env)) {
      const out = await sendEmail(env, r.email, msg.subject, msg.text.split(/\n{2,}/), { replyTo: env.OWNER_EMAIL });
      if (!out.ok) { results.push({ id: r.id, ok: false }); continue; } // try again on the next run
      await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(sentKey, new Date().toISOString()).run();
      await sendPush(env, { title: `Check-in details sent: ${r.name}`, message: `Arriving ${shortDate(r.check_in)}. The check-in guide went to ${r.email}.`, tags: ["envelope"], path: "/admin.html" });
      results.push({ id: r.id, ok: true });
    } else if (!(await env.DB.prepare("SELECT 1 FROM meta WHERE key = ?").bind(nudgeKey).first())) {
      await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(nudgeKey, new Date().toISOString()).run();
      await sendPush(env, { title: `Send check-in details: ${r.name}`, message: `${r.name} arrives ${shortDate(r.check_in)}. Email isn't set up yet, so open the dashboard and tap "Copy check-in message" on their booking.`, tags: ["envelope"], priority: 4, path: "/admin.html" });
      results.push({ id: r.id, nudged: true });
    }
  }
  return { results };
}
