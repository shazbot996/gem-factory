import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAllGems } from '../data/GemsProvider';

export default function GemDetail() {
  const { id } = useParams<{ id: string }>();
  const { gems, loading } = useAllGems();
  const [copied, setCopied] = useState(false);

  const gem = id ? gems.find((g) => g.id === id) : undefined;

  async function handleCopy() {
    if (!gem) return;
    await navigator.clipboard.writeText(gem.instructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading && !gem) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (!gem) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Gem not found.</p>
        <Link
          to="/"
          className="inline-block mt-4 text-schnucks-red hover:text-schnucks-red-dark"
        >
          Back to Registry
        </Link>
      </div>
    );
  }

  const hasKnowledge = gem.knowledgeFiles && gem.knowledgeFiles.length > 0;
  const hasTools =
    gem.defaultTools &&
    gem.defaultTools.length > 0 &&
    gem.defaultTools[0] !== 'No default tool';

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/"
          className="text-sm text-schnucks-red hover:text-schnucks-red-dark"
        >
          &larr; Back
        </Link>
      </div>

      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{gem.name}</h1>
          <span className="shrink-0 text-xs rounded-full px-2 py-1 bg-gray-100 text-gray-600">
            {gem.source}
          </span>
        </div>

        {gem.description && (
          <p className="mt-2 text-gray-600">{gem.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span>{gem.owner.displayName || gem.owner.email}</span>
          <span>Imported {new Date(gem.importedAt).toLocaleDateString()}</span>
          {gem.extractedAt && (
            <span>
              Extracted{' '}
              {new Date(gem.extractedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Instructions</h2>
          <button
            onClick={handleCopy}
            className="text-sm text-schnucks-red hover:text-schnucks-red-dark"
          >
            {copied ? 'Copied!' : 'Copy Instructions'}
          </button>
        </div>
        <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg overflow-auto max-h-96 text-sm border">
          {gem.instructions}
        </pre>
      </div>

      {hasKnowledge && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Knowledge Documents ({gem.knowledgeFiles.length})
          </h2>
          <div className="border rounded-lg divide-y">
            {gem.knowledgeFiles.map((kf, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <span className="text-lg" title={kf.mimeType}>
                  {getMimeIcon(kf.mimeType)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {kf.name}
                  </p>
                  <p className="text-xs text-gray-500">{kf.type || kf.mimeType}</p>
                </div>
                {kf.driveUrl ? (
                  <a
                    href={kf.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-schnucks-red hover:text-schnucks-red-dark shrink-0"
                  >
                    Open in Drive
                  </a>
                ) : (
                  <span className="text-xs text-gray-400 shrink-0">
                    No link
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasTools && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Enabled Tools
          </h2>
          <div className="flex flex-wrap gap-2">
            {gem.defaultTools.map((tool, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-sm"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getMimeIcon(mimeType: string): string {
  if (!mimeType) return '\u{1F4C4}';
  if (mimeType.includes('spreadsheet')) return '\u{1F4CA}';
  if (mimeType.includes('document')) return '\u{1F4C4}';
  if (mimeType.includes('presentation')) return '\u{1F4CA}';
  if (mimeType.includes('pdf')) return '\u{1F4C4}';
  if (mimeType.includes('image')) return '\u{1F5BC}';
  if (mimeType.includes('text')) return '\u{1F4DD}';
  return '\u{1F4C1}';
}
