import { useState, useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { listGems } from '../api/gems';
import { getStats } from '../api/stats';
import type { Gem, Stats } from '../api/types';
import GemCard from '../components/GemCard';
import EmptyState from '../components/EmptyState';

export default function Dashboard() {
  const { user } = useAuth();
  const [gems, setGems] = useState<Gem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [gemRes, statsRes] = await Promise.all([
          listGems({ owner: user?.email }),
          getStats(),
        ]);
        setGems(gemRes.gems);
        setStats(statsRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.email]);

  if (loading) {
    return <p className="text-center py-12 text-gray-500">Loading...</p>;
  }

  if (error) {
    return <p className="text-center py-12 text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Gems</h2>
        {gems.length === 0 ? (
          <EmptyState
            message="You haven't imported any gems yet."
            action={{ label: 'Import Gems', to: '/import' }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gems.map((gem) => (
              <GemCard key={gem.id} gem={gem} />
            ))}
          </div>
        )}
      </section>

      {stats && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Org Overview
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Gems" value={stats.totalGems} />
            <StatCard label="Unique Gems" value={stats.uniqueGems} />
            <StatCard label="Contributors" value={stats.totalUsers} />
            <StatCard label="Duplicate Clusters" value={stats.duplicateClusters} />
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}
