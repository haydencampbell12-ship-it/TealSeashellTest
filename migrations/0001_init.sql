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
