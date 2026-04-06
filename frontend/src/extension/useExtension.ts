import { useState, useEffect, useCallback } from 'react';
import type { ExtractedGem } from '../api/types';

const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID;

export interface UseExtensionResult {
  available: boolean;
  loading: boolean;
  gems: ExtractedGem[];
  fetchGems: () => Promise<void>;
  clearGems: () => Promise<void>;
  error: string | null;
}

function sendMessage(message: { type: string }): Promise<{ gems?: ExtractedGem[]; success?: boolean }> {
  return new Promise((resolve, reject) => {
    if (
      !EXTENSION_ID ||
      typeof chrome === 'undefined' ||
      !chrome.runtime?.sendMessage
    ) {
      reject(new Error('Extension not available'));
      return;
    }
    chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as { gems?: ExtractedGem[]; success?: boolean });
      }
    });
  });
}

export function useExtension(): UseExtensionResult {
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gems, setGems] = useState<ExtractedGem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchGems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await sendMessage({ type: 'GET_GEMS' });
      setAvailable(true);
      setGems(response?.gems || []);
    } catch {
      setAvailable(false);
      setGems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearGems = useCallback(async () => {
    try {
      await sendMessage({ type: 'CLEAR_GEMS' });
      setGems([]);
    } catch {
      setError('Failed to clear extension storage');
    }
  }, []);

  useEffect(() => {
    fetchGems();
  }, [fetchGems]);

  return { available, loading, gems, fetchGems, clearGems, error };
}
