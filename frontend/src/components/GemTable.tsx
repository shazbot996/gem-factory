import { Link } from 'react-router-dom';
import type { Gem } from '../api/types';

interface GemTableProps {
  gems: Gem[];
  onDelete: (gem: Gem) => void;
  deletingId: string | null;
}

export default function GemTable({ gems, onDelete, deletingId }: GemTableProps) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
              Owner
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
              Description
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell w-28">
              Updated
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {gems.map((gem) => (
            <GemRow
              key={gem.id}
              gem={gem}
              onDelete={onDelete}
              isDeleting={deletingId === gem.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface GemRowProps {
  gem: Gem;
  onDelete: (gem: Gem) => void;
  isDeleting: boolean;
}

function GemRow({ gem, onDelete, isDeleting }: GemRowProps) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5">
        <Link
          to={`/gems/${encodeURIComponent(gem.id)}`}
          className="text-sm font-medium text-gray-900 hover:text-schnucks-red"
        >
          {gem.name}
        </Link>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <span className="text-sm text-gray-500 truncate block max-w-[220px]">
          {gem.owner.displayName || gem.owner.email}
        </span>
      </td>
      <td className="px-4 py-2.5 hidden lg:table-cell">
        <span className="text-sm text-gray-500 truncate block max-w-[400px]">
          {gem.description || '—'}
        </span>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <span className="text-xs text-gray-400">
          {new Date(gem.updatedAt).toLocaleDateString()}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          onClick={() => onDelete(gem)}
          disabled={isDeleting}
          title="Delete this gem from the bucket"
          className="text-sm text-red-600 hover:text-red-800 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          {isDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}
