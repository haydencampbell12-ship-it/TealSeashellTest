-- Owner's notes on Airbnb / VRBO reservations: guest name and the actual payout
CREATE TABLE IF NOT EXISTS ext_payouts (
  source TEXT NOT NULL,
  uid TEXT NOT NULL,
  guest TEXT,
  payout_cents INTEGER,            -- NULL = use the estimate from the rate card
  note TEXT,
  is_booking INTEGER,              -- NULL = decide from the calendar entry, 1 = booking, 0 = just blocked
  updated_at TEXT,
  PRIMARY KEY (source, uid)
);

-- Expenses: 'monthly' repeats every month from start_month (to end_month if set);
-- 'once' is a single cost in the month of start_month.
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'monthly',
  start_month TEXT NOT NULL,       -- YYYY-MM
  end_month TEXT,                  -- YYYY-MM, inclusive, monthly only
  created_at TEXT NOT NULL
);

-- Starting point: the $1,500/month it costs to own the studio
INSERT OR IGNORE INTO expenses (id, name, amount_cents, kind, start_month, end_month, created_at)
VALUES ('e_carrying', 'Monthly carrying costs (mortgage, HOA, utilities)', 150000, 'monthly', '2026-07', NULL, '2026-11-05T00:00:00Z');
