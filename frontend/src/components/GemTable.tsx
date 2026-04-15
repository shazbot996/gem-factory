import { Link } from 'react-router-dom';
import type { Gem } from '../api/types';

interface GemTableProps {
  gems: Gem[];
  showOwner?: boolean;
}

export default function GemTable({ gems, showOwner = true }: GemTableProps) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            {showOwner && (
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                Owner
              </th>
            )}
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
              Description
            </th>
            <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell w-16">
              Docs
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
              Tools
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell w-28">
              Imported
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {gems.map((gem) => (
            <GemRow key={gem.id} gem={gem} showOwner={showOwner} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GemRow({ gem, showOwner }: { gem: Gem; showOwner: boolean }) {
  const hasKnowledge = gem.knowledgeFiles && gem.knowledgeFiles.length > 0;
  const hasTools =
    gem.defaultTools &&
    gem.defaultTools.length > 0 &&
    gem.defaultTools[0] !== 'No default tool';

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5">
        <Link
          to={`/gems/${gem.id}`}
          className="text-sm font-medium text-gray-900 hover:text-schnucks-red"
        >
          {gem.name}
        </Link>
      </td>
      {showOwner && (
        <td className="px-4 py-2.5 hidden md:table-cell">
          <span className="text-sm text-gray-500 truncate block max-w-[180px]">
            {gem.owner.displayName || gem.owner.email}
          </span>
        </td>
      )}
      <td className="px-4 py-2.5 hidden lg:table-cell">
        <span className="text-sm text-gray-500 truncate block max-w-[300px]">
          {gem.description || '\u2014'}
        </span>
      </td>
      <td className="px-4 py-2.5 text-center hidden sm:table-cell">
        {hasKnowledge ? (
          <span className="inline-flex items-center justify-center text-xs rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700 min-w-[20px]">
            {gem.knowledgeFiles.length}
          </span>
        ) : (
          <span className="text-gray-300">&mdash;</span>
        )}
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        {hasTools ? (
          <span className="text-xs text-purple-700 truncate block max-w-[160px]">
            {gem.defaultTools.join(', ')}
          </span>
        ) : (
          <span className="text-gray-300">&mdash;</span>
        )}
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <span className="text-xs text-gray-400">
          {new Date(gem.importedAt).toLocaleDateString()}
        </span>
      </td>
    </tr>
  );
}
