import { useState, useEffect } from 'react';
import { useExtension } from '../extension/useExtension';
import { importGems } from '../api/gems';
import type { ImportResult } from '../api/types';
import ImportPreview from '../components/ImportPreview';
import ManualImportForm from '../components/ManualImportForm';

export default function Import() {
  const { available, loading: extLoading, gems, fetchGems, clearGems, error: extError } =
    useExtension();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Select all gems by default when they load
  useEffect(() => {
    setSelected(new Set(gems.map((g) => g.id)));
  }, [gems]);

  function handleToggle(gemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gemId)) next.delete(gemId);
      else next.add(gemId);
      return next;
    });
  }

  function handleToggleAll() {
    if (selected.size === gems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(gems.map((g) => g.id)));
    }
  }

  async function handleImport() {
    const gemsToImport = gems
      .filter((g) => selected.has(g.id))
      .map((g) => ({
        name: g.name,
        instructions: g.instructions,
        source: 'extension' as const,
      }));

    if (gemsToImport.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const result = await importGems(gemsToImport);
      setImportResult(result);
      await clearGems();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handleManualImport(
    manualGems: { name: string; instructions: string; source: string }[],
  ) {
    setImporting(true);
    setImportError(null);
    try {
      const result = await importGems(manualGems);
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Import Gems</h1>

      {importResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          <p className="font-medium">Import complete</p>
          <p className="text-sm mt-1">
            {importResult.imported} imported, {importResult.skipped} skipped
            (already in your registry)
          </p>
        </div>
      )}

      {importError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {importError}
        </div>
      )}

      {extError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800">
          {extError}
        </div>
      )}

      {/* Extension import section */}
      {extLoading ? (
        <p className="text-gray-500">Checking for Chrome extension...</p>
      ) : available && gems.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              From Extension
              <span className="ml-2 text-sm font-normal bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                {gems.length} gems ready
              </span>
            </h2>
            <button
              onClick={fetchGems}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          </div>
          <ImportPreview
            gems={gems}
            selected={selected}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
          />
          <button
            onClick={handleImport}
            disabled={importing || selected.size === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {importing ? 'Importing...' : `Import Selected (${selected.size})`}
          </button>
        </section>
      ) : available && gems.length === 0 ? (
        <section className="bg-white border rounded-lg p-6 text-center text-gray-600">
          <p>
            No gems found in the extension. Open a gem's edit page in Gemini and
            click the blue button to extract it.
          </p>
        </section>
      ) : (
        <section className="bg-white border rounded-lg p-6 text-gray-600">
          <p className="font-medium text-gray-900">
            Chrome Extension Not Detected
          </p>
          <p className="mt-2 text-sm">
            Install the Gem Factory Chrome Extension to import gems directly from
            Gemini. Load it in developer mode from the{' '}
            <code className="bg-gray-100 px-1 rounded">extension/</code>{' '}
            directory.
          </p>
        </section>
      )}

      {/* Manual import section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Manual Import</h2>
        <ManualImportForm onImport={handleManualImport} loading={importing} />
      </section>
    </div>
  );
}
