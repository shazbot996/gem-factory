import { useState } from 'react';
import { useAllGems } from '../data/GemsProvider';
import GemTable from '../components/GemTable';
import EmptyState from '../components/EmptyState';
import type { Gem } from '../api/types';

export default function Registry() {
  const { gems, loading, error, deleteGem, reload } = useAllGems();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleDelete(gem: Gem) {
    const ok = window.confirm(
      `Delete "${gem.name}" from the bucket?\n\nThis removes ${gem.objectName} from ${gem.owner.email}. The Chrome extension still holds a local copy and can re-save it.`,
    );
    if (!ok) return;

    setDeletingId(gem.id);
    setActionError(null);
    try {
      await deleteGem(gem);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gem Registry</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {gems.length} gem{gems.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={reload}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {loading ? 'Reloading…' : 'Reload'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {actionError}
        </div>
      )}

      {loading && gems.length === 0 ? (
        <p className="text-center py-12 text-gray-500">Loading...</p>
      ) : gems.length === 0 ? (
        <EmptyState message="No gems in the bucket." />
      ) : (
        <GemTable
          gems={gems}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      )}
    </div>
  );
}
