import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getGem, deleteGem } from '../api/gems';
import { useAuth } from '../auth/useAuth';
import type { Gem } from '../api/types';
import { ApiError } from '../api/client';

export default function GemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [gem, setGem] = useState<Gem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      try {
        const data = await getGem(id);
        setGem(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load gem');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleCopy() {
    if (!gem) return;
    await navigator.clipboard.writeText(gem.instructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    if (!gem || !window.confirm(`Delete "${gem.name}"? This cannot be undone.`))
      return;
    setDeleting(true);
    try {
      await deleteGem(gem.id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete gem');
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (notFound) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Gem not found.</p>
        <Link
          to="/registry"
          className="inline-block mt-4 text-schnucks-red hover:text-schnucks-red-dark"
        >
          Back to Registry
        </Link>
      </div>
    );
  }

  if (error) {
    return <p className="text-center py-12 text-red-600">{error}</p>;
  }

  if (!gem) return null;

  const isOwner = user?.email === gem.owner.email;
  const hasKnowledge = gem.knowledgeFiles && gem.knowledgeFiles.length > 0;
  const hasTools =
    gem.defaultTools &&
    gem.defaultTools.length > 0 &&
    gem.defaultTools[0] !== 'No default tool';

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={isOwner ? '/' : '/registry'}
          className="text-sm text-schnucks-red hover:text-schnucks-red-dark"
        >
          &larr; Back
        </Link>
      </div>

      {/* Header */}
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
          <span className="capitalize">Status: {gem.status}</span>
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

        {gem.duplicateCluster && (
          <p className="mt-1 text-sm text-amber-600">
            Part of a cluster with {gem.duplicateCluster.gemCount} similar gems
          </p>
        )}
      </div>

      {/* Instructions */}
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

      {/* Knowledge Files */}
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

      {/* Default Tools */}
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

      {/* Actions */}
      {isOwner && (
        <div className="pt-4 border-t">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
          >
            {deleting ? 'Deleting...' : 'Delete Gem'}
          </button>
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
