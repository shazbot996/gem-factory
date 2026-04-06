export interface GemOwner {
  id: string;
  email: string;
  displayName: string;
}

export interface Gem {
  id: string;
  name: string;
  instructions: string;
  icon: string | null;
  source: string;
  status: string;
  owner: GemOwner;
  importedAt: string;
  updatedAt: string;
  duplicateCluster: { id: string; gemCount: number } | null;
}

export interface GemListResponse {
  gems: Gem[];
  pagination: { page: number; limit: number; total: number };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  importedIds: string[];
}

export interface UserProfile {
  id?: string;
  email: string;
  displayName: string;
  gemCount: number;
  firstImportAt: string | null;
  lastImportAt: string | null;
}

export interface UserListItem {
  id: string;
  email: string;
  displayName: string;
  gemCount: number;
}

export interface Stats {
  totalGems: number;
  uniqueGems: number;
  totalUsers: number;
  duplicateClusters: number;
  topClusters: { id: string; representativeName: string; gemCount: number }[];
}

export interface ExtractedGem {
  id: string;
  name: string;
  description: string;
  instructions: string;
  knowledgeFiles: string[];
  extractedAt: string;
  source: string;
}
