import { Router } from 'express';
import { query } from '../db';

export const router = Router();

// Postgres returns snake_case columns (start_date, end_date, etc.) — the
// app expects camelCase (startDate, endDate, etc.). Without this mapping,
// those fields come through as undefined on the client, which is why the
// history date range was rendering as "Invalid Date" instead of a real date.
function toFlagEvent(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    region: row.region,
    status: row.status,
    reason: row.reason,
    issuedBy: row.issued_by,
    startDate: row.start_date,
    endDate: row.end_date,
    sourceUrl: row.source_url,
  };
}

// GET /status?states=CO,NY — current status for federal + requested states
router.get('/status', async (req, res) => {
  const states = String(req.query.states ?? '')
    .split(',')
    .filter(Boolean);

  const regions = ['US', ...states];
  const rows = await query(
    `SELECT DISTINCT ON (region) *
     FROM flag_events
     WHERE region = ANY($1) AND (end_date IS NULL OR end_date > now())
     ORDER BY region, start_date DESC`,
    [regions]
  );

  const byRegion: Record<string, any> = {};
  for (const row of rows) byRegion[row.region] = toFlagEvent(row);

  res.json({
    federal: byRegion['US'] ?? { region: 'US', status: 'full-staff' },
    states: Object.fromEntries(
      states.map((s) => [s, byRegion[s] ?? { region: s, status: 'full-staff' }])
    ),
  });
});

// GET /events/:region?limit=10 — recent history for one region
router.get('/events/:region', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const rows = await query(
    `SELECT * FROM flag_events WHERE region = $1 ORDER BY start_date DESC LIMIT $2`,
    [req.params.region, limit]
  );
  res.json(rows.map(toFlagEvent));
});

// POST /device-tokens — register a device for push
router.post('/device-tokens', async (req, res) => {
  const { token, platform } = req.body;
  if (!token || !platform) {
    return res.status(400).json({ error: 'token and platform are required' });
  }
  await query(
    `INSERT INTO device_tokens (expo_push_token, platform)
     VALUES ($1, $2)
     ON CONFLICT (expo_push_token) DO UPDATE SET last_seen_at = now()`,
    [token, platform]
  );
  res.status(204).send();
});

// POST /subscriptions — sync a device's followed regions + notification prefs
router.post('/subscriptions', async (req, res) => {
  const { token, followedStates, notifications } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const deviceRows = await query<{ id: number }>(
    `SELECT id FROM device_tokens WHERE expo_push_token = $1`,
    [token]
  );
  if (deviceRows.length === 0) {
    return res.status(404).json({ error: 'unknown device token' });
  }
  const deviceId = deviceRows[0].id;
  const regions = ['US', ...(followedStates ?? [])];

  await query(`DELETE FROM subscriptions WHERE device_token_id = $1`, [deviceId]);
  for (const region of regions) {
    await query(
      `INSERT INTO subscriptions (device_token_id, region, notify_half_staff, notify_full_staff, notify_daily_digest)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        deviceId,
        region,
        notifications?.federalChanges ?? true,
        notifications?.returnToFullStaff ?? false,
        notifications?.dailyDigest ?? false,
      ]
    );
  }
  res.status(204).send();
});
