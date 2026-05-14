import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAllGems } from '../data/GemsProvider';
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

  const { gems, loading, error } = useAllGems();

  const owners = useMemo(() => {
    const set = new Map<string, string>();
    for (const g of gems) {
      const email = g.owner.email.toLowerCase();
      if (!set.has(email)) set.set(email, g.owner.displayName || email);
    }
    return Array.from(set.entries())
      .map(([email, displayName]) => ({ email, displayName }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }, [gems]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ownerNeedle = owner.trim().toLowerCase();
    return gems.filter((g) => {
      if (ownerNeedle && g.owner.email.toLowerCase() !== ownerNeedle) return false;
      if (!needle) return true;
      return (
        g.name.toLowerCase().includes(needle) ||
        (g.description || '').toLowerCase().includes(needle) ||
        g.instructions.toLowerCase().includes(needle)
      );
    });
  }, [gems, q, owner]);

  const total = filtered.length;
  const pageGems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

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
          {owners.map((u) => (
            <option key={u.email} value={u.email}>
              {u.displayName}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {loading && gems.length === 0 ? (
        <p className="text-center py-12 text-gray-500">Loading...</p>
      ) : pageGems.length === 0 ? (
        <EmptyState message="No gems match your search." />
      ) : (
        <>
          <GemTable gems={pageGems} />
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
