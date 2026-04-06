export async function upsertUser(pool, { email, displayName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET display_name = COALESCE(EXCLUDED.display_name, users.display_name)
     RETURNING *`,
    [email, displayName || null]
  );
  return rows[0];
}

export async function updateLastImport(pool, userId) {
  await pool.query(
    `UPDATE users
     SET last_import_at = now(),
         first_import_at = COALESCE(first_import_at, now())
     WHERE id = $1`,
    [userId]
  );
}

export async function findByEmail(pool, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

export async function findById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listWithGemCounts(pool) {
  const { rows } = await pool.query(
    `SELECT u.*, COUNT(g.id)::int AS gem_count
     FROM users u
     LEFT JOIN gems g ON g.owner_id = u.id
     GROUP BY u.id
     ORDER BY gem_count DESC`
  );
  return rows;
}
