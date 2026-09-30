import { Router } from 'express';
import { loadDataHealth } from '../lib/data-health';

const router = Router();

// GET /api/data-health — provenance of the links and checks on the data (see lib/data-health)
router.get('/', async (_req, res) => {
  res.json(await loadDataHealth());
});

export default router;
