-- Booking requests from the website
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  check_in TEXT NOT NULL,          -- YYYY-MM-DD
  check_out TEXT NOT NULL,         -- YYYY-MM-DD (exclusive)
  nights INTEGER NOT NULL,
  guests INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  quote_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  -- pending -> approved (awaiting payment, holds dates) -> confirmed
  -- or declined / expired / cancelled
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT,
  payment_url TEXT,
  hold_expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_dates ON requests(check_in, check_out);

-- Dates the owner blocks by hand (personal use, maintenance)
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,          -- exclusive
  note TEXT,
  created_at TEXT NOT NULL
);

-- Bookings imported from Airbnb / VRBO calendar feeds
CREATE TABLE IF NOT EXISTS ext_events (
  source TEXT NOT NULL,            -- 'airbnb' | 'vrbo'
  uid TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,          -- exclusive
  summary TEXT,
  PRIMARY KEY (source, uid)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
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

-- Table for stays entered by hand or copied from statements.
-- Your own statement history is loaded separately so guest names never go to GitHub.
CREATE TABLE IF NOT EXISTS stays_manual (
  id TEXT PRIMARY KEY,
  guest TEXT NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'managed',  -- 'managed' (from a statement), 'airbnb', 'vrbo' or 'other'
  host_payout_cents INTEGER NOT NULL,
  cleaning_cents INTEGER NOT NULL,
  taxes_cents INTEGER NOT NULL,
  statement TEXT,                         -- which statement it came from
  created_at TEXT NOT NULL
);
