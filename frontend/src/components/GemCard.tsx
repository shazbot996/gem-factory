import { Link } from 'react-router-dom';
import type { Gem } from '../api/types';

export default function GemCard({ gem }: { gem: Gem }) {
  const preview =
    gem.instructions.length > 100
      ? gem.instructions.slice(0, 100) + '...'
      : gem.instructions;

  return (
    <Link
      to={`/gems/${gem.id}`}
      className="block border rounded-lg p-4 hover:shadow-md transition-shadow bg-white"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 truncate">{gem.name}</h3>
        <span className="shrink-0 text-xs rounded-full px-2 py-0.5 bg-blue-100 text-blue-700">
          {gem.source}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">{gem.owner.email}</p>
      <p className="mt-2 text-sm text-gray-600">{preview}</p>
      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
        <span>{new Date(gem.importedAt).toLocaleDateString()}</span>
        {gem.duplicateCluster && (
          <span className="rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">
            {gem.duplicateCluster.gemCount} similar
          </span>
        )}
      </div>
    </Link>
  );
}
