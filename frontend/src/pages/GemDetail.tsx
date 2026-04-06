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
          className="inline-block mt-4 text-blue-600 hover:text-blue-800"
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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{gem.name}</h1>
          <span className="shrink-0 text-xs rounded-full px-2 py-1 bg-blue-100 text-blue-700">
            {gem.source}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
          <span>{gem.owner.email}</span>
          <span>Imported {new Date(gem.importedAt).toLocaleDateString()}</span>
          <span className="capitalize">Status: {gem.status}</span>
        </div>
        {gem.duplicateCluster && (
          <p className="mt-1 text-sm text-amber-600">
            Part of a cluster with {gem.duplicateCluster.gemCount} similar gems
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900">Instructions</h2>
          <button
            onClick={handleCopy}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {copied ? 'Copied!' : 'Copy Instructions'}
          </button>
        </div>
        <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg overflow-auto max-h-96 text-sm border">
          {gem.instructions}
        </pre>
      </div>

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
