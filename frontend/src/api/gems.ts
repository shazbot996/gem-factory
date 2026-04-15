import { apiRequest } from './client';
import type { Gem, GemListResponse, ImportResult, KnowledgeFile } from './types';

export async function importGems(
  gems: {
    name: string;
    description?: string;
    instructions: string;
    icon?: string;
    source?: string;
    geminiId?: string | null;
    knowledgeFiles?: KnowledgeFile[];
    defaultTools?: string[];
    extractedAt?: string | null;
  }[],
): Promise<ImportResult> {
  return apiRequest('/api/gems/import', {
    method: 'POST',
    body: JSON.stringify({ gems }),
  });
}

export async function listGems(
  params: {
    q?: string;
    owner?: string;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<GemListResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.owner) qs.set('owner', params.owner);
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return apiRequest(`/api/gems${query ? '?' + query : ''}`);
}

export async function getGem(id: string): Promise<Gem> {
  return apiRequest(`/api/gems/${encodeURIComponent(id)}`);
}

export async function deleteGem(id: string): Promise<void> {
  await apiRequest(`/api/gems/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
