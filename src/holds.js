// Refundable damage hold: placed on check-in day, released after check-out.
import { PROPERTY, DAMAGE_HOLD } from "./config.js";
import { placeHold, releaseHold, chargeHold } from "./stripe.js";
import { addDays, todayLocal } from "./dates.js";
import { sendEmail, money } from "./email.js";
import { sendPush, shortDate } from "./notify.js";
const nowISO = () => new Date().toISOString();

const MAX_ATTEMPTS = 3;

async function tellOwner(env, title, lines, tags = []) {
  await Promise.all([
    sendEmail(env, env.OWNER_EMAIL, title, lines),
    sendPush(env, { title, message: lines.join("\n"), tags })
  ]);
}

// Runs from the scheduled job every 30 minutes
export async function runHolds(env) {
  if (!env.STRIPE_SECRET_KEY) return;
  const today = todayLocal();

  // 1. Place holds for guests arriving today
  const arriving = await env.DB.prepare(
    `SELECT * FROM requests WHERE status = 'confirmed' AND check_in <= ? AND check_out > ?
     AND stripe_payment_method_id IS NOT NULL AND (hold_status IS NULL OR (hold_status = 'failed' AND hold_attempts < ?))`
  ).bind(today, today, MAX_ATTEMPTS).all();
  for (const r of arriving.results) {
    // Only on the check-in day itself, so a late-confirmed stay doesn't get a surprise hold mid-stay
    if (r.check_in !== today) continue;
    const attempt = (r.hold_attempts || 0) + 1;
    try {
      const pi = await placeHold(env, r, attempt);
      const ok = pi.status === "requires_capture";
      await env.DB.prepare("UPDATE requests SET hold_pi_id = ?, hold_status = ?, hold_cents = ?, hold_attempts = ?, hold_note = ?, updated_at = ? WHERE id = ?")
        .bind(pi.id, ok ? "held" : "failed", pi.amount, attempt, ok ? null : `Card needs the guest's approval (${pi.status})`, nowISO(), r.id).run();
      if (!ok) await tellOwner(env, `Damage hold didn't go through: ${r.name}`, [`The ${money(DAMAGE_HOLD.amount * 100)} hold for ${r.name} (${shortDate(r.check_in)}–${shortDate(r.check_out)}) needs the guest's approval with their bank, so it wasn't placed.`, "Ask the guest for another card, or carry on without a hold."], ["warning"]);
    } catch (e) {
      await env.DB.prepare("UPDATE requests SET hold_status = 'failed', hold_attempts = ?, hold_note = ?, updated_at = ? WHERE id = ?")
        .bind(attempt, String(e.message).slice(0, 300), nowISO(), r.id).run();
      if (attempt >= MAX_ATTEMPTS || e.stripe?.type === "card_error") {
        await env.DB.prepare("UPDATE requests SET hold_attempts = ? WHERE id = ?").bind(MAX_ATTEMPTS, r.id).run();
        await tellOwner(env, `Damage hold declined: ${r.name}`, [`The ${money(DAMAGE_HOLD.amount * 100)} hold for ${r.name} (${shortDate(r.check_in)}–${shortDate(r.check_out)}) was declined: ${e.message}`, "Ask the guest for another card, or carry on without a hold."], ["warning"]);
      }
    }
  }

  // 2. Release holds a few days after check-out unless you charged them
  const due = await env.DB.prepare("SELECT * FROM requests WHERE hold_status = 'held' AND check_out <= ?")
    .bind(addDays(today, -DAMAGE_HOLD.releaseDaysAfterCheckout)).all();
  for (const r of due.results) {
    try {
      await releaseHold(env, r.hold_pi_id);
      await env.DB.prepare("UPDATE requests SET hold_status = 'released', updated_at = ? WHERE id = ?").bind(nowISO(), r.id).run();
    } catch (e) {
      // Already released by the bank (holds last about 7 days) or cancelled in Stripe
      await env.DB.prepare("UPDATE requests SET hold_status = 'expired', hold_note = ?, updated_at = ? WHERE id = ?").bind(String(e.message).slice(0, 300), nowISO(), r.id).run();
    }
  }
}

// Dashboard buttons
export async function holdAction(env, id, action, body) {
  const r = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(id).first();
  if (!r) return { ok: false, status: 404, error: "That booking no longer exists." };
  if (r.hold_status !== "held" || !r.hold_pi_id) return { ok: false, error: "There's no active damage hold on this booking." };
  if (action === "release") {
    try { await releaseHold(env, r.hold_pi_id); }
    catch (e) { return { ok: false, status: 502, error: `Stripe couldn't release the hold: ${e.message}` }; }
    await env.DB.prepare("UPDATE requests SET hold_status = 'released', updated_at = ? WHERE id = ?").bind(nowISO(), id).run();
    return { ok: true, message: "Hold released. The guest's bank usually drops it within a few days." };
  }
  if (action === "charge") {
    const dollars = Number(String(body?.amount ?? "").replace(/[$,\s]/g, ""));
    const cents = Math.round(dollars * 100);
    if (!Number.isFinite(dollars) || cents < 50) return { ok: false, error: "Enter an amount of at least $0.50." };
    if (cents > r.hold_cents) return { ok: false, error: `You can charge up to ${money(r.hold_cents)}, the amount of the hold. Send an invoice from Stripe for anything more.` };
    const reason = String(body?.reason || "").trim().slice(0, 200);
    if (!reason) return { ok: false, error: "Add a short reason, like \"2 missing wristbands\". It's included in the guest's email." };
    try { await chargeHold(env, r.hold_pi_id, cents); }
    catch (e) { return { ok: false, status: 502, error: `Stripe couldn't charge the hold: ${e.message}` }; }
    await env.DB.prepare("UPDATE requests SET hold_status = 'charged', hold_charged_cents = ?, hold_note = ?, updated_at = ? WHERE id = ?").bind(cents, reason, nowISO(), id).run();
    await sendEmail(env, r.email, `Charge from your damage hold at ${PROPERTY.name}`, [
      `Hi ${r.name},`,
      `Thanks for staying with us. We charged ${money(cents)} from your ${money(r.hold_cents)} damage hold for: ${reason}.`,
      cents < r.hold_cents ? `The remaining ${money(r.hold_cents - cents)} has been released back to your card.` : "",
      `Reply to this email with any questions.`,
      `— ${PROPERTY.name}`
    ].filter(Boolean), { replyTo: PROPERTY.contactEmail });
    return { ok: true, message: `Charged ${money(cents)}. The rest of the hold was released and the guest was emailed.` };
  }
  return { ok: false, status: 404, error: "Unknown action." };
}
