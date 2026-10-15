// One-off end-to-end push test for Halyard.
// Mirrors the query and payload in notifySubscribers() (pushSender.ts) for
// region US / half-staff, but also prints Expo's per-message results, which
// the production sender currently ignores.
//
// Usage (from the halyard-backend folder):
//   node scripts/testAlert.cjs          -> dry run: lists who would get it
//   node scripts/testAlert.cjs --send   -> actually sends the test push
//
// DATABASE_URL must be set in your terminal first (never pasted into chat).

const { Client } = require('pg');

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const doSend = process.argv.includes('--send');

const mask = (t) => (t.length > 24 ? t.slice(0, 22) + '...]' : t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in this terminal. See the instructions.');
    process.exit(1);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const { rows } = await db.query(
    `SELECT dt.expo_push_token, dt.platform, dt.last_seen_at
     FROM subscriptions s
     JOIN device_tokens dt ON dt.id = s.device_token_id
     WHERE s.region = $1 AND s.notify_half_staff = true
     ORDER BY dt.last_seen_at DESC`,
    ['US']
  );
  await db.end();

  console.log(`\nDevices subscribed to Federal half-staff alerts: ${rows.length}`);
  rows.forEach((r, i) =>
    console.log(`  ${i + 1}. ${mask(r.expo_push_token)}  ${r.platform}  last seen ${new Date(r.last_seen_at).toISOString()}`)
  );

  if (rows.length === 0) {
    console.log('\nNobody is subscribed, so a real alert would reach no one. Open the app, check Settings, and retry.');
    return;
  }
  if (!doSend) {
    console.log('\nDry run only. Run again with --send to push a test alert to the devices above.');
    return;
  }

  const messages = rows.map((r) => ({
    to: r.expo_push_token,
    title: 'Halyard test alert',
    body: 'If you can read this, push alerts work end to end.',
    data: { region: 'US', status: 'half-staff', test: true },
  }));

  const res = await fetch(EXPO_SEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  console.log(`\nExpo responded: HTTP ${res.status}`);
  const body = await res.json();
  const tickets = body.data ?? [];
  const ids = [];

  tickets.forEach((t, i) => {
    if (t.status === 'ok') {
      console.log(`  ${i + 1}. accepted by Expo (ticket ${t.id})`);
      ids.push(t.id);
    } else {
      console.log(`  ${i + 1}. REJECTED: ${t.message} [${t.details?.error ?? 'no code'}]`);
    }
  });
  if (body.errors) console.log('Request-level errors:', JSON.stringify(body.errors));

  if (ids.length === 0) return;

  console.log('\nWaiting 20 seconds, then checking whether Firebase accepted delivery...');
  await sleep(20000);
  const rr = await fetch(EXPO_RECEIPTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const receipts = (await rr.json()).data ?? {};
  for (const id of ids) {
    const r = receipts[id];
    if (!r) console.log(`  ${id}: no receipt yet (try again in a minute)`);
    else if (r.status === 'ok') console.log(`  ${id}: delivered to Google's push service OK`);
    else console.log(`  ${id}: FAILED: ${r.message} [${r.details?.error ?? 'no code'}]`);
  }
}

main().catch((e) => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
