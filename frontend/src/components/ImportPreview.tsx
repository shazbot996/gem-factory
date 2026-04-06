import type { ExtractedGem } from '../api/types';

interface ImportPreviewProps {
  gems: ExtractedGem[];
  selected: Set<string>;
  onToggle: (gemId: string) => void;
  onToggleAll: () => void;
}

export default function ImportPreview({
  gems,
  selected,
  onToggle,
  onToggleAll,
}: ImportPreviewProps) {
  const allSelected = gems.length > 0 && gems.every((g) => selected.has(g.id));

  return (
    <div className="border rounded-lg divide-y bg-white">
      <div className="px-4 py-3 flex items-center gap-3 bg-gray-50 rounded-t-lg">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          className="rounded"
        />
        <span className="text-sm font-medium text-gray-700">
          Select all ({gems.length})
        </span>
      </div>
      {gems.map((gem) => (
        <label
          key={gem.id}
          className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selected.has(gem.id)}
            onChange={() => onToggle(gem.id)}
            className="mt-1 rounded"
          />
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{gem.name}</p>
            <p className="text-sm text-gray-600 truncate">
              {gem.instructions.slice(0, 80)}
              {gem.instructions.length > 80 ? '...' : ''}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Extracted {new Date(gem.extractedAt).toLocaleString()}
            </p>
          </div>
        </label>
      ))}
    </div>
  );
}
