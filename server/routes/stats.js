import { Router } from 'express';
import pool from '../db/pool.js';
import requireAdmin from '../middleware/admin.js';

const router = Router();

// GET /api/stats — admin only
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [gemsResult, uniqueResult, usersResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM gems'),
      pool.query('SELECT COUNT(DISTINCT instruction_hash)::int AS count FROM gems'),
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
    ]);

    res.json({
      totalGems: gemsResult.rows[0].count,
      uniqueGems: uniqueResult.rows[0].count,
      totalUsers: usersResult.rows[0].count,
      duplicateClusters: 0, // Clustering deferred
      topClusters: [],      // Clustering deferred
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
