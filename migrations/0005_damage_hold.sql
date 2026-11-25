-- Saved card for the damage hold, the hold itself, and terms acceptance
ALTER TABLE requests ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE requests ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE requests ADD COLUMN terms_accepted_at TEXT;
-- hold_status: held | released | charged | failed | expired
ALTER TABLE requests ADD COLUMN hold_pi_id TEXT;
ALTER TABLE requests ADD COLUMN hold_status TEXT;
ALTER TABLE requests ADD COLUMN hold_cents INTEGER;
ALTER TABLE requests ADD COLUMN hold_charged_cents INTEGER;
ALTER TABLE requests ADD COLUMN hold_note TEXT;
ALTER TABLE requests ADD COLUMN hold_attempts INTEGER NOT NULL DEFAULT 0;
