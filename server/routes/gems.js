import { Router } from 'express';
import pool from '../db/pool.js';
import * as gemsDb from '../db/gems.js';
import * as usersDb from '../db/users.js';
import { importGems } from '../services/ingestion.js';
import { isAdmin } from '../middleware/admin.js';

const router = Router();

const MAX_IMPORT = 100;
const MAX_INSTRUCTION_LENGTH = 100 * 1024; // 100KB

// POST /api/gems/import
router.post('/import', async (req, res) => {
  try {
    const { gems } = req.body;

    if (!Array.isArray(gems) || gems.length === 0) {
      return res.status(400).json({ error: 'gems must be a non-empty array' });
    }
    if (gems.length > MAX_IMPORT) {
      return res.status(400).json({ error: `Maximum ${MAX_IMPORT} gems per import` });
    }

    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (!g.name || typeof g.name !== 'string' || !g.name.trim()) {
        return res.status(400).json({ error: `gems[${i}].name must be a non-empty string` });
      }
      if (!g.instructions || typeof g.instructions !== 'string' || !g.instructions.trim()) {
        return res.status(400).json({ error: `gems[${i}].instructions must not be empty` });
      }
      if (g.instructions.length > MAX_INSTRUCTION_LENGTH) {
        return res.status(400).json({ error: `gems[${i}].instructions exceed maximum length` });
      }
    }

    // Upsert user
    const user = await usersDb.upsertUser(pool, {
      email: req.user.email,
      displayName: req.user.name,
    });

    const result = await importGems(pool, { userId: user.id, gemsPayload: gems });
    res.json(result);
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gems
router.get('/', async (req, res) => {
  try {
    let { q, owner, status, page, limit } = req.query;
    page = Math.max(1, parseInt(page, 10) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    // Non-admins are scoped to their own gems regardless of any owner query param.
    // Admins may pass ?owner=<email> to filter by a specific user, or omit it to see all.
    const admin = isAdmin(req.user.email);
    const ownerFilter = admin ? (owner || null) : req.user.email;

    const { gems, total } = await gemsDb.list(pool, {
      q: q || null,
      owner: ownerFilter,
      status: status || null,
      page,
      limit,
    });

    const formatted = gems.map(formatGem);
    res.json({ gems: formatted, pagination: { page, limit, total } });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gems/:id
router.get('/:id', async (req, res) => {
  try {
    const gem = await gemsDb.findById(pool, req.params.id);
    if (!gem) return res.status(404).json({ error: 'Gem not found' });

    // Non-admins can only view their own gems. Return 404 (not 403) for other
    // users' gems to avoid leaking their existence.
    if (!isAdmin(req.user.email) && gem.owner.email !== req.user.email) {
      return res.status(404).json({ error: 'Gem not found' });
    }

    res.json(formatGem(gem));
  } catch (err) {
    console.error('Get gem error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/gems/:id
router.patch('/:id', async (req, res) => {
  try {
    const gem = await gemsDb.findById(pool, req.params.id);
    if (!gem) return res.status(404).json({ error: 'Gem not found' });

    const isOwner = gem.owner.email === req.user.email;
    const admin = isAdmin(req.user.email);

    if (!isOwner && !admin) {
      return res.status(403).json({ error: 'Only the owner or an admin can update this gem' });
    }

    const fields = {};
    if (req.body.name !== undefined) fields.name = req.body.name;
    if (req.body.description !== undefined) fields.description = req.body.description;
    if (req.body.icon !== undefined) fields.icon = req.body.icon;

    if (req.body.status !== undefined) {
      if (!admin) {
        return res.status(403).json({ error: 'Only admins can change gem status' });
      }
      fields.status = req.body.status;
    }

    const updated = await gemsDb.update(pool, req.params.id, fields);
    const full = await gemsDb.findById(pool, req.params.id);
    res.json(formatGem(full));
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/gems/:id
router.delete('/:id', async (req, res) => {
  try {
    const gem = await gemsDb.findById(pool, req.params.id);
    if (!gem) return res.status(404).json({ error: 'Gem not found' });

    const isOwner = gem.owner.email === req.user.email;
    const admin = isAdmin(req.user.email);

    if (!isOwner && !admin) {
      return res.status(403).json({ error: 'Only the owner or an admin can delete this gem' });
    }

    await gemsDb.remove(pool, req.params.id);
    res.status(204).end();
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function formatGem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    instructions: row.instructions,
    icon: row.icon,
    source: row.source,
    status: row.status,
    geminiId: row.gemini_id || null,
    knowledgeFiles: row.knowledge_files || [],
    defaultTools: row.default_tools || [],
    owner: row.owner,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    extractedAt: row.extracted_at || null,
    duplicateCluster: null, // Clustering deferred
  };
}

export default router;
