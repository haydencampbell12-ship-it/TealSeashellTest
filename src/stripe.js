import { PRICING, PROPERTY } from "./config.js";

// Create a Stripe Checkout payment page for an approved request
export async function createCheckout(env, req, expiresAtSec) {
  const site = env.SITE_URL.replace(/\/$/, "");
  const form = new URLSearchParams({
    mode: "payment",
    customer_email: req.email,
    expires_at: String(expiresAtSec),
    success_url: `${site}/thanks.html?paid=1`,
    cancel_url: `${site}/`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": PRICING.currency,
    "line_items[0][price_data][unit_amount]": String(req.total_cents),
    "line_items[0][price_data][product_data][name]": `${PROPERTY.name}: ${req.check_in} to ${req.check_out}`,
    "line_items[0][price_data][product_data][description]": `${req.nights} nights, ${req.guests} guest${req.guests > 1 ? "s" : ""}. Includes cleaning fee and lodging taxes.`,
    "metadata[request_id]": req.id,
    "payment_intent_data[metadata][request_id]": req.id
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
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
