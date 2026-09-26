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
import { authMiddleware } from './middleware/auth';
import { seedDatabase } from './lib/seed';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();

// Behind nginx / the Docker network: trust only private-range proxies for req.ip
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const guardWrites: express.RequestHandler = (req, res, next) => {
  if (WRITE_METHODS.includes(req.method)) {
    authMiddleware(req, res, next);
  } else {
    next();
  }
};

// Auth routes — fully public (login endpoint)
app.use('/api/auth', authRouter);

// Health — always public
app.use('/api/health', healthRouter);

// Read=public, Write=protected
app.use('/api/pages', guardWrites, pagesRouter);
app.use('/api/categories', guardWrites, categoriesRouter);
app.use('/api/rules', guardWrites, rulesRouter);
app.use('/api/spl', guardWrites, splRouter);

// Backups — fully protected (handled inside router)
app.use('/api/backup', backupRouter);

// Tags — public reads, auth writes (handled inside router)
app.use('/api/tags', tagsRouter);

// Read-only / safe
app.use('/api/links', linksRouter);
app.use('/api/search', searchRouter);

// Page types — public reads, auth writes (handled inside router)
app.use('/api/page-types', pageTypesRouter);

// Sysmon events — public reads, auth writes (handled inside router)
app.use('/api/sysmon-events', sysmonEventsRouter);

// Fully protected routes
app.use('/api/users', usersRouter);
app.use('/api/docs', docsRouter);
app.use('/api/activity', activityRouter);

setInterval(() => {
  runJsonBackup().catch((err) => console.error('Scheduled backup failed:', err));
}, 86400000);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Seed and start
seedDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DetectKB backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
