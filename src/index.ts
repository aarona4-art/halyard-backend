import express from 'express';
import { router } from './routes/api';
import { startPollingJob } from './jobs/pollFlagStatus';

// Last line of defense: log instead of letting Node kill the whole process.
// This is a safety net for bugs we haven't anticipated — it should never be
// the ONLY error handling in the app (see pollFlagStatus.ts for the real
// fix to the specific crash this project hit), but it stops one unexpected
// error anywhere from taking the entire server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server staying up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server staying up):', err);
});

const app = express();
app.use(express.json());
app.use('/', router);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Flag status backend listening on port ${PORT}`);
  startPollingJob();
});
