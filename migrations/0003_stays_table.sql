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
