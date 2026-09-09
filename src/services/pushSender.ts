import { query } from '../db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Sends a batch of push messages via Expo's push API (max 100 per request). */
async function sendBatch(messages: PushMessage[]) {
  if (messages.length === 0) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('Expo push send failed', await res.text());
  }
}

interface NotifyEventInput {
  region: string; // 'US' or a state abbreviation
  status: 'half-staff' | 'full-staff';
  reason: string | null;
}

/**
 * Finds every device subscribed to this region with the matching
 * notification type enabled, and pushes to all of them in batches of 100
 * (Expo's per-request limit).
 */
export async function notifySubscribers({ region, status, reason }: NotifyEventInput) {
  const column = status === 'half-staff' ? 'notify_half_staff' : 'notify_full_staff';

  const rows = await query<{ expo_push_token: string }>(
    `SELECT dt.expo_push_token
     FROM subscriptions s
     JOIN device_tokens dt ON dt.id = s.device_token_id
     WHERE s.region = $1 AND s.${column} = true`,
    [region]
  );

  const title =
    status === 'half-staff'
      ? `${regionLabel(region)} flag lowered to half-staff`
      : `${regionLabel(region)} flag returned to full-staff`;
  const body = reason ?? (status === 'half-staff' ? 'Tap for details.' : '');

  const messages: PushMessage[] = rows.map((r) => ({
    to: r.expo_push_token,
    title,
    body,
    data: { region, status },
  }));

  for (let i = 0; i < messages.length; i += 100) {
    await sendBatch(messages.slice(i, i + 100));
  }

  return messages.length;
}

function regionLabel(region: string) {
  return region === 'US' ? 'Federal' : region;
}
