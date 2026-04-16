export interface GemOwner {
  id: string;
  email: string;
  displayName: string;
}

export interface KnowledgeFile {
  name: string;
  type: string;
  mimeType: string;
  driveId: string | null;
  driveUrl: string | null;
}

export interface Gem {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  icon: string | null;
  source: string;
  status: string;
  geminiId: string | null;
  knowledgeFiles: KnowledgeFile[];
  defaultTools: string[];
  owner: GemOwner;
  importedAt: string;
  updatedAt: string;
  extractedAt: string | null;
  duplicateCluster: { id: string; gemCount: number } | null;
}

export interface GemListResponse {
  gems: Gem[];
  pagination: { page: number; limit: number; total: number };
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  importedIds: string[];
}

export interface UserProfile {
  id?: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
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
  knowledgeFiles: KnowledgeFile[];
  defaultTools: string[];
  extractedAt: string;
  source: string;
}
