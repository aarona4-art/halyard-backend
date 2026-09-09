-- Devices that have registered for push notifications
CREATE TABLE device_tokens (
  id SERIAL PRIMARY KEY,
  expo_push_token TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which regions + notification types each device wants to hear about
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  device_token_id INTEGER NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  region TEXT NOT NULL, -- 'US' for federal, or a state abbreviation
  notify_half_staff BOOLEAN NOT NULL DEFAULT true,
  notify_full_staff BOOLEAN NOT NULL DEFAULT false,
  notify_daily_digest BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (device_token_id, region)
);

-- Known flag events, deduplicated by source + region + start date so the
-- poll job can detect "is this new?" without re-notifying on every run
CREATE TABLE flag_events (
  id SERIAL PRIMARY KEY,
  region TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('half-staff', 'full-staff')),
  reason TEXT,
  issued_by TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  source_url TEXT,
  notified_at TIMESTAMPTZ, -- null until a push has gone out for this event
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (region, status, start_date)
);

CREATE INDEX idx_subscriptions_region ON subscriptions(region);
CREATE INDEX idx_flag_events_region_notified ON flag_events(region, notified_at);
