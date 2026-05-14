// Shared types for gem documents loaded from GCS. The shape mirrors the
// JSON we write at users/<email>/gems.json — with a few synthetic fields
// (id, owner, importedAt, updatedAt) added by the gcsClient for the UI.

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
