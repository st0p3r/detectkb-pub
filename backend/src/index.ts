import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { BACKUP_DIR, CORS_ORIGIN, PORT } from './lib/config';
import healthRouter from './routes/health';
import pagesRouter from './routes/pages';
import categoriesRouter from './routes/categories';
import linksRouter from './routes/links';
import rulesRouter from './routes/rules';
import splRouter from './routes/spl';
import searchRouter from './routes/search';
import tagsRouter from './routes/tags';
import backupRouter, { runJsonBackup } from './routes/backup';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import docsRouter from './routes/docs';
import pageTypesRouter from './routes/page-types';
import sysmonEventsRouter from './routes/sysmon-events';
import activityRouter from './routes/activity';
import dashboardRouter from './routes/dashboard';
import { markDataChanged } from './lib/kb-cache';
import sigmaRouter from './routes/sigma';
import ruleImportRouter from './routes/rule-import';
import referencesRouter from './routes/references';
import graphRouter from './routes/graph';
import attackRouter from './routes/attack';
import { authMiddleware, guard, requirePermission } from './middleware/auth';
import { seedDatabase } from './lib/seed';
import { syncAllSysmonLinks } from './lib/sysmon-links';
import { fetchMissingReferenceData } from './lib/reference-bootstrap';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();

// Behind nginx / the Docker network: trust only private-range proxies for req.ip
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(cors({ origin: CORS_ORIGIN }));
// Reference datasets (LOLDrivers' drivers.json is ~20 MB) get a larger body limit
app.use('/api/references/upload', express.json({ limit: '100mb' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

// Public endpoints
app.use('/api/auth', authRouter);
app.use('/api/health', healthRouter);

// Everything below requires a logged-in, active user
app.use('/api', authMiddleware);

// A successful write may change what the knowledge graph and the tool matches
// are built from: mark those caches stale (lib/kb-cache). Writes that only
// produce files or touch accounts don't count.
const WRITES_WITHOUT_KB_CHANGES = /^\/api\/(docs|users|sigma\/convert|backup\/json$)/;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !WRITES_WITHOUT_KB_CHANGES.test(req.originalUrl.split('?')[0])) {
    res.on('finish', () => {
      if (res.statusCode < 400) markDataChanged();
    });
  }
  next();
});

app.use('/api/pages', guard('pages', { checkReads: true }), pagesRouter);
app.use('/api/categories', guard('pages'), categoriesRouter);
app.use('/api/rules', guard('rules', { checkReads: true }), rulesRouter);
app.use('/api/spl', guard('pages'), splRouter);
app.use('/api/tags', guard('tags', { checkReads: true }), tagsRouter);
app.use('/api/links', linksRouter);
app.use('/api/search', searchRouter);
app.use('/api/page-types', pageTypesRouter);
app.use('/api/sysmon-events', guard('rules'), sysmonEventsRouter);
app.use('/api/sigma', sigmaRouter);
app.use('/api/rules-import', ruleImportRouter);
app.use('/api/references', referencesRouter);
app.use('/api/graph', graphRouter);
app.use('/api/attack', attackRouter);
app.use('/api/dashboard', dashboardRouter);

// Routers that check permissions per route
app.use('/api/backup', backupRouter);
app.use('/api/users', usersRouter);
app.use('/api/docs', docsRouter);
app.use('/api/activity', requirePermission('audit:read'), activityRouter);

setInterval(() => {
  runJsonBackup().catch((err) => console.error('Scheduled backup failed:', err));
}, 86400000);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Seed and start
seedDatabase()
  .then(() => syncAllSysmonLinks())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DetectKB backend running on http://localhost:${PORT}`);
    });
    // Background: download LOLBAS / GTFOBins / LOLDrivers on first start
    fetchMissingReferenceData();
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
