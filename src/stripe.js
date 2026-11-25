import { PRICING, PROPERTY, DAMAGE_HOLD } from "./config.js";

const API_DEFAULT = "https://api.stripe.com/v1";

async function stripe(env, method, path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch((env.STRIPE_API_BASE || API_DEFAULT) + path, { method, headers, body: params ? params : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || `Stripe error ${res.status}`);
    e.stripe = data?.error || {};
    throw e;
  }
  return data;
}

const nightsLabel = (n) => `${n} night${n > 1 ? "s" : ""}`;

// Split the saved quote into what the guest sees on Stripe's page and receipt:
// lodging, cleaning fee and each tax. Falls back to one line if anything doesn't add up.
export function checkoutLines(req) {
  const single = [{ name: `${PROPERTY.name}: ${req.check_in} to ${req.check_out}`, description: `${nightsLabel(req.nights)}, ${req.guests} guest${req.guests > 1 ? "s" : ""}. Includes cleaning fee and lodging taxes.`, cents: req.total_cents }];
  let lines;
  try { lines = JSON.parse(req.quote_json || "{}").lines; } catch { return single; }
  if (!Array.isArray(lines) || lines.length < 3) return single;
  // Older quotes have no "kind": cleaning is labeled, taxes mention "tax"
  const kindOf = (l) => l.kind || (l.label === "Cleaning fee" ? "cleaning" : /tax/i.test(l.label) ? "tax" : l.cents < 0 ? "discount" : "lodging");
  const cleaning = lines.filter((l) => kindOf(l) === "cleaning");
  const taxes = lines.filter((l) => kindOf(l) === "tax");
  if (cleaning.length !== 1 || !taxes.length) return single;
  const taxTotal = taxes.reduce((a, l) => a + l.cents, 0);
  const lodging = req.total_cents - cleaning[0].cents - taxTotal; // nightly rates less any discount
  const discounted = lines.some((l) => kindOf(l) === "discount");
  const out = [
    { name: `Lodging: ${req.check_in} to ${req.check_out}`, description: `${PROPERTY.name}, ${nightsLabel(req.nights)}${discounted ? ", weekly discount applied" : ""}`, cents: lodging },
    { name: "Cleaning fee", cents: cleaning[0].cents },
    ...taxes.map((t) => ({ name: t.label, description: "Charged on lodging and cleaning", cents: t.cents }))
  ];
  if (out.some((l) => !Number.isInteger(l.cents) || l.cents <= 0)) return single;
  if (out.reduce((a, l) => a + l.cents, 0) !== req.total_cents) return single;
  return out;
}

const holdDollars = () => `$${DAMAGE_HOLD.amount}`;

// Create a Stripe Checkout payment page for an approved request
export async function createCheckout(env, req, expiresAtSec) {
  const site = env.SITE_URL.replace(/\/$/, "");
  const form = new URLSearchParams({
    mode: "payment",
    customer_email: req.email,
    // Save the card to this guest so the damage hold can be placed on check-in day
    customer_creation: "always",
    "payment_intent_data[setup_future_usage]": "off_session",
    expires_at: String(expiresAtSec),
    success_url: `${site}/thanks.html?paid=1`,
    cancel_url: `${site}/`,
    // Cards only (Apple Pay, Google Pay and Link still show). Bank payments can take
    // days to clear, longer than the hold on the dates, and can't carry a damage hold.
    "payment_method_types[0]": "card",
    "metadata[request_id]": req.id,
    "payment_intent_data[metadata][request_id]": req.id,
    "payment_intent_data[description]": `${PROPERTY.name}: ${req.check_in} to ${req.check_out}`,
    "custom_text[submit][message]": `Your card is saved for a refundable ${holdDollars()} damage hold, placed on check-in day and released after check-out.`
  });
  checkoutLines(req).forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, "1");
    form.set(`line_items[${i}][price_data][currency]`, PRICING.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
    if (l.description) form.set(`line_items[${i}][price_data][product_data][description]`, l.description);
  });
  // Required "I agree" checkbox. Stripe only allows it once a terms URL is saved in
  // the Stripe dashboard; until then, the page goes out without it.
  const withTerms = new URLSearchParams(form);
  withTerms.set("consent_collection[terms_of_service]", "required");
  withTerms.set("custom_text[terms_of_service_acceptance][message]",
    `I agree to the [House Rules and Rental Terms](${site}/terms.html), including the cancellation policy and the refundable ${holdDollars()} damage hold.`);
  const key = `checkout-${req.id}-${expiresAtSec}`;
  let data;
  try {
    data = await stripe(env, "POST", "/checkout/sessions", withTerms, key + "-t");
  } catch (e) {
    if (!/terms of service|consent_collection/i.test(e.message)) throw e;
    console.warn("Checkout without terms checkbox:", e.message);
    data = await stripe(env, "POST", "/checkout/sessions", form, key);
  }
  return { id: data.id, url: data.url, termsCheckbox: !!data.consent_collection?.terms_of_service };
}

export async function expireCheckout(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY || !sessionId) return;
  await stripe(env, "POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`).catch(() => {});
}

// The saved card and customer from a paid Checkout Session
export async function savedCard(env, session) {
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return {};
  const pi = await stripe(env, "GET", `/payment_intents/${encodeURIComponent(piId)}`);
  return { customer: pi.customer || session.customer || null, paymentMethod: pi.payment_method || null, paymentIntent: pi.id };
}

// Place the damage hold: an authorization only, nothing is charged
export async function placeHold(env, req, attempt = 1) {
  const form = new URLSearchParams({
    amount: String(DAMAGE_HOLD.amount * 100),
    currency: PRICING.currency,
    customer: req.stripe_customer_id,
    payment_method: req.stripe_payment_method_id,
    capture_method: "manual",
    confirm: "true",
    off_session: "true",
    description: `Refundable damage hold: ${PROPERTY.name}, ${req.check_in} to ${req.check_out}`,
    "metadata[request_id]": req.id,
    "metadata[type]": "damage_hold"
  });
  return stripe(env, "POST", "/payment_intents", form, `hold-${req.id}-${attempt}`);
}

export async function releaseHold(env, piId) {
  return stripe(env, "POST", `/payment_intents/${encodeURIComponent(piId)}/cancel`, new URLSearchParams({ cancellation_reason: "requested_by_customer" }));
}

// Charge part or all of the hold. Whatever isn't charged goes back to the guest.
export async function chargeHold(env, piId, cents) {
  return stripe(env, "POST", `/payment_intents/${encodeURIComponent(piId)}/capture`, new URLSearchParams({ amount_to_capture: String(cents) }));
}
