import express from 'express';
import { router } from './routes/api';
import { startPollingJob } from './jobs/pollFlagStatus';

const app = express();
app.use(express.json());
app.use('/', router);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Flag status backend listening on port ${PORT}`);
  startPollingJob();
});
