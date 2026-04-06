import { apiRequest } from './client';
import type { Stats } from './types';

export async function getStats(): Promise<Stats> {
  return apiRequest('/api/stats');
}
