import cron from 'node-cron';
import { query } from '../db';
import { fetchRawEvents } from '../services/flagDataSource';
import { notifySubscribers } from '../services/pushSender';

/**
 * Inserts a flag event if it's new (unique on region + status + start_date).
 * Returns true if it was actually new, false if we'd already seen it.
 */
async function upsertIfNew(event: {
  region: string;
  status: 'half-staff' | 'full-staff';
  reason: string | null;
  issuedBy: string | null;
  startDate: string;
  endDate: string | null;
  sourceUrl: string | null;
}): Promise<boolean> {
  const rows = await query(
    `INSERT INTO flag_events (region, status, reason, issued_by, start_date, end_date, source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (region, status, start_date) DO NOTHING
     RETURNING id`,
    [
      event.region,
      event.status,
      event.reason,
      event.issuedBy,
      event.startDate,
      event.endDate,
      event.sourceUrl,
    ]
  );
  return rows.length > 0;
}

async function markNotified(region: string, status: string, startDate: string) {
  await query(
    `UPDATE flag_events SET notified_at = now()
     WHERE region = $1 AND status = $2 AND start_date = $3`,
    [region, status, startDate]
  );
}

export async function pollFlagStatus() {
  let events;
  try {
    events = await fetchRawEvents();
  } catch (err) {
    console.error('Failed to fetch flag status', err);
    return;
  }

  for (const event of events) {
    const isNew = await upsertIfNew(event);
    if (isNew) {
      const sentCount = await notifySubscribers({
        region: event.region,
        status: event.status,
        reason: event.reason,
      });
      await markNotified(event.region, event.status, event.startDate);
      console.log(`New ${event.status} event for ${event.region}: notified ${sentCount} devices`);
    }
  }
}

/** Starts the recurring poll — every 30 minutes. Adjust to taste. */
export function startPollingJob() {
  cron.schedule('*/30 * * * *', pollFlagStatus);
  // Run once immediately on boot so status isn't stale until the first tick
  pollFlagStatus();
}
