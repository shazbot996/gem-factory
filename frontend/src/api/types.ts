// Gem documents loaded from GCS. The shape mirrors the JSON written by
// the Chrome extension at users/<email>/gems/<id>.json, with a few
// synthetic fields (id, owner, objectName, deletable, updatedAt) added by
// the gcsClient for the UI.

export interface GemOwner {
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
  // Composite "<email>/<geminiId>" identifier used in URLs and as a React key.
  id: string;
  // The full GCS object name this gem was loaded from (e.g.
  // "users/foo%40bar.com/gems/abc123.json"). Used to delete the object.
  objectName: string;
  name: string;
  description: string | null;
  instructions: string;
  source: string;
  knowledgeFiles: KnowledgeFile[];
  defaultTools: string[];
  owner: GemOwner;
  updatedAt: string;
  extractedAt: string | null;
}
