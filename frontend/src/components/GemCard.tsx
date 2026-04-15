import { Link } from 'react-router-dom';
import type { Gem } from '../api/types';

export default function GemCard({ gem }: { gem: Gem }) {
  const preview =
    gem.instructions.length > 120
      ? gem.instructions.slice(0, 120) + '...'
      : gem.instructions;

  const hasKnowledge = gem.knowledgeFiles && gem.knowledgeFiles.length > 0;
  const hasTools =
    gem.defaultTools &&
    gem.defaultTools.length > 0 &&
    gem.defaultTools[0] !== 'No default tool';

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

      {gem.description && (
        <p className="mt-1 text-sm text-gray-500 line-clamp-1">
          {gem.description}
        </p>
      )}

      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{preview}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">
          {gem.owner.displayName || gem.owner.email}
        </span>
        <span className="text-gray-300">&middot;</span>
        <span className="text-gray-400">
          {new Date(gem.importedAt).toLocaleDateString()}
        </span>

        {hasKnowledge && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">
              {gem.knowledgeFiles.length} doc{gem.knowledgeFiles.length !== 1 ? 's' : ''}
            </span>
          </>
        )}

        {hasTools && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="rounded-full px-2 py-0.5 bg-purple-50 text-purple-700">
              {gem.defaultTools.join(', ')}
            </span>
          </>
        )}

        {gem.duplicateCluster && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span className="rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">
              {gem.duplicateCluster.gemCount} similar
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
