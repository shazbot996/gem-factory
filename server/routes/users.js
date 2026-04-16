import { Router } from 'express';
import pool from '../db/pool.js';
import * as usersDb from '../db/users.js';
import * as gemsDb from '../db/gems.js';
import requireAdmin, { isAdmin } from '../middleware/admin.js';

const router = Router();

// GET /api/users/me
router.get('/me', async (req, res) => {
  try {
    const user = await usersDb.findByEmail(pool, req.user.email);
    if (!user) {
      return res.json({
        email: req.user.email,
        displayName: req.user.name,
        isAdmin: isAdmin(req.user.email),
        gemCount: 0,
        firstImportAt: null,
        lastImportAt: null,
      });
    }

    const gemCount = await gemsDb.countByOwner(pool, user.id);
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: isAdmin(user.email),
      gemCount,
      firstImportAt: user.first_import_at,
      lastImportAt: user.last_import_at,
    });
  } catch (err) {
    console.error('Users/me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users — admin only
router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await usersDb.listWithGemCounts(pool);
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        gemCount: u.gem_count,
        firstImportAt: u.first_import_at,
        lastImportAt: u.last_import_at,
      })),
    });
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
