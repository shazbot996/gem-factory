export function buildSearchClause(q) {
  if (q) {
    return {
      where: `search_vector @@ plainto_tsquery('english', $N)`,
      orderBy: `ts_rank(search_vector, plainto_tsquery('english', $N)) DESC`,
      params: [q],
    };
  }
  return { where: null, orderBy: 'imported_at DESC', params: [] };
}
