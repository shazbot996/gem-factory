export async function insertGem(pool, { ownerId, name, instructions, icon, source, instructionHash }) {
  const { rows } = await pool.query(
    `INSERT INTO gems (owner_id, name, instructions, icon, source, instruction_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (owner_id, instruction_hash) DO NOTHING
     RETURNING *`,
    [ownerId, name, instructions, icon || null, source || 'extension', instructionHash]
  );
  return rows[0] || null;
}

export async function findById(pool, id) {
  const { rows } = await pool.query(
    `SELECT g.*,
            json_build_object('id', u.id, 'email', u.email, 'displayName', u.display_name) AS owner
     FROM gems g
     JOIN users u ON u.id = g.owner_id
     WHERE g.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function list(pool, { q, owner, status, page = 1, limit = 20 }) {
  const conditions = [];
  const params = [];
  let orderBy = 'g.imported_at DESC';

  if (q) {
    params.push(q);
    conditions.push(`g.search_vector @@ plainto_tsquery('english', $${params.length})`);
    orderBy = `ts_rank(g.search_vector, plainto_tsquery('english', $${params.length})) DESC`;
  }

  if (owner) {
    params.push(owner);
    conditions.push(`u.email = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`g.status = $${params.length}`);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count query
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM gems g JOIN users u ON u.id = g.owner_id ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query with pagination
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT g.*,
            json_build_object('id', u.id, 'email', u.email, 'displayName', u.display_name) AS owner
     FROM gems g
     JOIN users u ON u.id = g.owner_id
     ${where}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { gems: rows, total };
}

export async function update(pool, id, fields) {
  const allowed = ['name', 'icon', 'status'];
  const sets = [];
  const params = [id];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }

  if (sets.length === 0) return findById(pool, id);

  sets.push('updated_at = now()');

  const { rows } = await pool.query(
    `UPDATE gems SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function remove(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM gems WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function countByOwner(pool, ownerId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) FROM gems WHERE owner_id = $1',
    [ownerId]
  );
  return parseInt(rows[0].count, 10);
}
