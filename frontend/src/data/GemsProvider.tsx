// Loads every users/<email>/gems.json from the configured GCS bucket once
// per session and shares the flattened gem list with all pages. Pages can
// call useAllGems() to consume the cached data or trigger a manual reload.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { loadAllGems } from '../api/gcsClient';
import { config } from '../config';
import { useAuth } from '../auth/useAuth';
import type { Gem } from '../api/types';

interface GemsContextValue {
  gems: Gem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const GemsContext = createContext<GemsContextValue | null>(null);

export function GemsProvider({ children }: { children: ReactNode }) {
  const { accessToken, isAuthenticated } = useAuth();
  const [gems, setGems] = useState<Gem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadAllGems(config.bucketName);
      setGems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gems');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isAuthenticated) {
      setGems([]);
      hasLoadedRef.current = false;
      return;
    }
    if (!accessToken) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    reload();
  }, [accessToken, isAuthenticated, reload]);

  const value = useMemo(
    () => ({ gems, loading, error, reload }),
    [gems, loading, error, reload],
  );

  return <GemsContext.Provider value={value}>{children}</GemsContext.Provider>;
}

export function useAllGems(): GemsContextValue {
  const ctx = useContext(GemsContext);
  if (!ctx) throw new Error('useAllGems must be used inside <GemsProvider>');
  return ctx;
}
