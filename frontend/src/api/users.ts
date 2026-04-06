import { apiRequest } from './client';
import type { UserProfile, UserListItem } from './types';

export async function getMe(): Promise<UserProfile> {
  return apiRequest('/api/users/me');
}

export async function listUsers(): Promise<{ users: UserListItem[] }> {
  return apiRequest('/api/users');
}
