import { PRICING, PROPERTY } from "./config.js";

// Split the saved quote into what the guest sees on Stripe's page and receipt:
// lodging, cleaning fee and taxes. Falls back to one line if anything doesn't add up.
export function checkoutLines(req) {
  const nightsLabel = `${req.nights} night${req.nights > 1 ? "s" : ""}`;
  const single = [{ name: `${PROPERTY.name}: ${req.check_in} to ${req.check_out}`, description: `${nightsLabel}, ${req.guests} guest${req.guests > 1 ? "s" : ""}. Includes cleaning fee and lodging taxes.`, cents: req.total_cents }];
  let lines;
  try { lines = JSON.parse(req.quote_json || "{}").lines; } catch { return single; }
  if (!Array.isArray(lines) || lines.length < 3) return single;
  const tax = lines[lines.length - 1];
  const cleaning = lines[lines.length - 2];
  if (cleaning.label !== "Cleaning fee") return single;
  const lodging = req.total_cents - cleaning.cents - tax.cents;
  const discounted = lines.some((l) => l.cents < 0);
  const out = [
    { name: `Lodging: ${req.check_in} to ${req.check_out}`, description: `${PROPERTY.name}, ${nightsLabel}${discounted ? ", weekly discount applied" : ""}`, cents: lodging },
    { name: "Cleaning fee", cents: cleaning.cents },
    { name: tax.label, description: "State and local taxes on short-term rentals", cents: tax.cents }
  ];
  if (out.some((l) => !Number.isInteger(l.cents) || l.cents <= 0)) return single;
  if (out.reduce((a, l) => a + l.cents, 0) !== req.total_cents) return single;
  return out;
}

// Create a Stripe Checkout payment page for an approved request
export async function createCheckout(env, req, expiresAtSec) {
  const site = env.SITE_URL.replace(/\/$/, "");
  const form = new URLSearchParams({
    mode: "payment",
    customer_email: req.email,
    expires_at: String(expiresAtSec),
    success_url: `${site}/thanks.html?paid=1`,
    cancel_url: `${site}/`,
    // Cards only (Apple Pay, Google Pay and Link still show). Bank payments can take
    // days to clear, longer than the hold on the dates.
    "payment_method_types[0]": "card",
    "metadata[request_id]": req.id,
    "payment_intent_data[metadata][request_id]": req.id,
    "payment_intent_data[description]": `${PROPERTY.name}: ${req.check_in} to ${req.check_out}`
  });
  checkoutLines(req).forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, "1");
    form.set(`line_items[${i}][price_data][currency]`, PRICING.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
    if (l.description) form.set(`line_items[${i}][price_data][product_data][description]`, l.description);
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Re-approving the same request within the same hold can't create a second payment page
      "Idempotency-Key": `checkout-${req.id}-${expiresAtSec}`
    },
    body: form
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return { id: data.id, url: data.url };
}

export async function expireCheckout(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY || !sessionId) return;
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  }).catch(() => {});
}
