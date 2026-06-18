// Read + delete Google Cloud Storage client for the SPA. The SPA loads
// every per-gem object at users/<email>/gems/<id>.json and aggregates
// them for the registry view.
//
// Pre-rewrite (cf1752a) extensions wrote a consolidated
// users/<email>/gems.json file. That format is no longer read by the SPA
// — any such files sitting in the bucket are ignored. Use `gcloud storage
// cat` / `rm` to inspect or remove them by hand.
//
// Auth: an OAuth access token (devstorage.read_write scope) is set by
// AuthProvider after the GIS Token Client returns. The SPA never writes
// new gems — only the Chrome extension does — but it can DELETE existing
// per-gem objects in admin mode.

import type { Gem, GemOwner } from './types';

let currentAccessToken: string | null = null;
let onTokenInvalid: (() => Promise<string | null>) | null = null;

export function setGcsAccessToken(token: string | null) {
  currentAccessToken = token;
}

export function setOnTokenInvalid(fn: (() => Promise<string | null>) | null) {
  onTokenInvalid = fn;
}

export class GcsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GcsError';
    this.status = status;
  }
}

interface GcsObjectListResponse {
  items?: { name: string; updated: string; etag: string }[];
  nextPageToken?: string;
}

interface UserGemsDocument {
  schemaVersion?: number;
  owner: string;
  updatedAt: string | null;
  gems: Array<{
    id: string;
    name: string;
    description?: string;
    instructions: string;
    knowledgeFiles?: Array<{
      name: string;
      type?: string;
      mimeType?: string;
      driveId?: string | null;
      driveUrl?: string | null;
    }>;
    defaultTools?: string[];
    source?: string;
    extractedAt?: string | null;
  }>;
}

async function gcsFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!currentAccessToken) {
    throw new GcsError(401, 'No GCS access token available — sign in first.');
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${currentAccessToken}`);
  const res = await fetch(url, { ...init, headers });

  if (res.status === 401 && onTokenInvalid) {
    const fresh = await onTokenInvalid();
    if (fresh) {
      currentAccessToken = fresh;
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set('Authorization', `Bearer ${fresh}`);
      return fetch(url, { ...init, headers: retryHeaders });
    }
  }
  return res;
}

// Matches the per-gem users/<email>/gems/<id>.json objects. Any other
// path under users/ (including the legacy users/<email>/gems.json file)
// is ignored by the SPA.
const PER_GEM_DOC = /^users\/[^/]+\/gems\/[^/]+\.json$/;

export async function listUserObjects(bucket: string): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ prefix: 'users/' });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params.toString()}`;
    const res = await gcsFetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new GcsError(res.status, `Failed to list bucket: ${res.status} ${body}`);
    }
    const data = (await res.json()) as GcsObjectListResponse;
    if (data.items) {
      for (const item of data.items) {
        if (PER_GEM_DOC.test(item.name)) {
          names.push(item.name);
        }
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return names;
}

export async function downloadObject(bucket: string, name: string): Promise<UserGemsDocument | null> {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await gcsFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new GcsError(res.status, `Failed to download ${name}: ${res.status} ${body}`);
  }
  return (await res.json()) as UserGemsDocument;
}

export async function deleteObject(bucket: string, name: string): Promise<void> {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
  const res = await gcsFetch(url, { method: 'DELETE' });
  if (res.status === 404) return; // already gone — treat as success
  if (!res.ok) {
    const body = await res.text();
    throw new GcsError(res.status, `Failed to delete ${name}: ${res.status} ${body}`);
  }
}

function ownerEmailFromPath(name: string): string {
  // Matches "users/<encoded-email>/gems/<id>.json".
  const match = name.match(/^users\/([^/]+)\//);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// Flatten every per-gem document into a Gem[] for the UI. Each Gem
// carries the GCS object name it came from so the registry can DELETE
// the underlying object on demand.
export async function loadAllGems(bucket: string): Promise<Gem[]> {
  const objectNames = await listUserObjects(bucket);
  const documents = await Promise.all(
    objectNames.map((name) => downloadObject(bucket, name).then((doc) => ({ name, doc }))),
  );

  const flattened: Gem[] = [];
  for (const { name, doc } of documents) {
    if (!doc || !Array.isArray(doc.gems)) continue;
    const ownerEmail = (doc.owner || ownerEmailFromPath(name)).toLowerCase();
    const owner: GemOwner = {
      email: ownerEmail,
      displayName: ownerEmail,
    };
    const updatedAt = doc.updatedAt || new Date(0).toISOString();
    for (const g of doc.gems) {
      flattened.push({
        id: `${ownerEmail}/${g.id}`,
        objectName: name,
        name: g.name,
        description: g.description || null,
        instructions: g.instructions,
        source: g.source || 'edit_page',
        knowledgeFiles: (g.knowledgeFiles || []).map((k) => ({
          name: k.name,
          type: k.type || '',
          mimeType: k.mimeType || '',
          driveId: k.driveId || null,
          driveUrl: k.driveUrl || null,
        })),
        defaultTools: g.defaultTools || [],
        owner,
        updatedAt,
        extractedAt: g.extractedAt || null,
      });
    }
  }
  return flattened;
}
