import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listGems } from '../api/gems';
import { listUsers } from '../api/users';
import type { Gem, UserListItem } from '../api/types';
import GemTable from '../components/GemTable';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

const PAGE_SIZE = 50;

export default function Registry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const owner = searchParams.get('owner') || '';
  const page = Number(searchParams.get('page')) || 1;

  const [gems, setGems] = useState<Gem[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUsers()
      .then((res) => setUsers(res.users))
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listGems({
          q: q || undefined,
          owner: owner || undefined,
          page,
          limit: PAGE_SIZE,
        });
        setGems(res.gems);
        setTotal(res.pagination.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load gems');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [q, owner, page]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gem Registry</h1>
        {!loading && (
          <span className="text-sm text-gray-500">{total} gem{total !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <SearchBar
            value={q}
            onChange={(v) => updateParams({ q: v, page: '' })}
          />
        </div>
        <select
          value={owner}
          onChange={(e) => updateParams({ owner: e.target.value, page: '' })}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-schnucks-red focus:border-schnucks-red outline-none"
        >
          <option value="">All owners</option>
          {users.map((u) => (
            <option key={u.id} value={u.email}>
              {u.displayName || u.email}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-center py-12 text-gray-500">Loading...</p>
      ) : gems.length === 0 ? (
        <EmptyState message="No gems match your search." />
      ) : (
        <>
          <GemTable gems={gems} />
          <Pagination
            page={page}
            limit={PAGE_SIZE}
            total={total}
            onPageChange={(p) => updateParams({ page: String(p) })}
          />
        </>
      )}
    </div>
  );
}
