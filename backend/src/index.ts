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
import savedViewsRouter from './routes/saved-views';
import logSourcesRouter from './routes/log-sources';
import threatIntelRouter from './routes/threat-intel';
import storiesRouter from './routes/stories';
import atomicsRouter from './routes/atomics';
import validationRouter from './routes/validation';
import upstreamRouter from './routes/upstream';
import { checkStaleSources } from './lib/upstream';
import dataHealthRouter from './routes/data-health';
import { markDataChanged } from './lib/kb-cache';
import sigmaRouter from './routes/sigma';
import ruleImportRouter from './routes/rule-import';
import referencesRouter from './routes/references';
import graphRouter from './routes/graph';
import attackRouter from './routes/attack';
import { authMiddleware, guard, requirePermission } from './middleware/auth';
import { seedDatabase } from './lib/seed';
import { syncAllDerivedLinks } from './lib/derived-links';
import { fetchMissingReferenceData } from './lib/reference-bootstrap';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();

// Behind nginx / the Docker network: trust only private-range proxies for req.ip
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
// Headers for API responses (nginx sets the page-level ones, including the CSP)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Cross-origin access only when explicitly configured (comma-separated origins)
if (CORS_ORIGIN) app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((o) => o.trim()) }));
// Unauthenticated endpoints get a small body limit
app.use('/api/auth', express.json({ limit: '10kb' }));
// Reference datasets (LOLDrivers' drivers.json is ~20 MB) get a larger body limit
app.use('/api/references/upload', express.json({ limit: '100mb' }));
app.use('/api/upstream/check-upload', express.json({ limit: '100mb' }));
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
const WRITES_WITHOUT_KB_CHANGES = /^\/api\/(docs|users|sigma\/convert|rules-import\/preview|saved-views|backup\/json$|upstream\/(check|check-upload|dismiss|sources)\b)/;
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
app.use('/api/log-sources', guard('rules'), logSourcesRouter);
app.use('/api/threat-intel', threatIntelRouter);
app.use('/api/stories', guard('rules'), storiesRouter);
app.use('/api/atomics', atomicsRouter);
app.use('/api/validation', validationRouter);
app.use('/api/upstream', upstreamRouter);
app.use('/api/data-health', dataHealthRouter);
app.use('/api/sigma', sigmaRouter);
app.use('/api/rules-import', ruleImportRouter);
app.use('/api/references', referencesRouter);
app.use('/api/graph', graphRouter);
app.use('/api/attack', attackRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/saved-views', savedViewsRouter);

// Routers that check permissions per route
app.use('/api/backup', backupRouter);
app.use('/api/users', usersRouter);
app.use('/api/docs', docsRouter);
app.use('/api/activity', requirePermission('audit:read'), activityRouter);

setInterval(() => {
  runJsonBackup().catch((err) => console.error('Scheduled backup failed:', err));
}, 86400000);

// Upstream rule repositories: checked weekly in the background (UPSTREAM_AUTO_CHECK=false turns it off)
if (process.env.UPSTREAM_AUTO_CHECK !== 'false' && process.env.REFERENCE_AUTO_FETCH !== 'false') {
  const runCheck = () => checkStaleSources().catch((err) => console.warn('[upstream] check failed:', err));
  setTimeout(runCheck, 10 * 60000).unref();
  setInterval(runCheck, 6 * 3600000).unref();
}

app.use((err: Error & { status?: number; expose?: boolean }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Client errors from body parsing etc. (e.g. 400 bad JSON, 413 too large) keep their status;
  // anything else is logged and answered with a generic message so internals don't leak
  if (err.status && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.expose ? err.message : 'Bad request' });
    return;
  }
  console.error(`${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Internal server error' });
});

// Seed and start
seedDatabase()
  .then(() => syncAllDerivedLinks())
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
