import { query } from '../db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function mask(token: string) {
  return token.length > 24 ? `${token.slice(0, 22)}...]` : token;
}

/**
 * Expo permanently rejects tokens for uninstalled apps or reset devices
 * (DeviceNotRegistered). Remove them so we stop sending to dead tokens.
 * Subscriptions are deleted first so this works regardless of FK cascade rules.
 */
async function removeDeadTokens(tokens: string[]) {
  try {
    await query(
      `DELETE FROM subscriptions
       WHERE device_token_id IN (
         SELECT id FROM device_tokens WHERE expo_push_token = ANY($1)
       )`,
      [tokens]
    );
    await query(`DELETE FROM device_tokens WHERE expo_push_token = ANY($1)`, [tokens]);
    console.log(`Removed ${tokens.length} unregistered device token(s)`);
  } catch (err) {
    console.error('Failed to remove dead device tokens', err);
  }
}

/**
 * Sends a batch of push messages via Expo's push API (max 100 per request).
 * Expo answers HTTP 200 even when it rejects individual messages, so the
 * per-message tickets are checked and failures are logged.
 */
async function sendBatch(messages: PushMessage[]) {
  if (messages.length === 0) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('Expo push send failed', res.status, await res.text());
    return;
  }

  const body = (await res.json()) as { data?: ExpoTicket[] };
  const tickets = body.data ?? [];
  const dead: string[] = [];

  tickets.forEach((ticket, i) => {
    if (ticket.status !== 'error') return;
    const code = ticket.details?.error ?? 'no code';
    console.error(`Push rejected for ${mask(messages[i].to)}: ${ticket.message} [${code}]`);
    if (code === 'DeviceNotRegistered') dead.push(messages[i].to);
  });

  if (dead.length > 0) await removeDeadTokens(dead);
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
