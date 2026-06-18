// Read-only Google Cloud Storage client for the SPA. The SPA loads every
// per-gem object at users/<email>/gems/<id>.json (plus any legacy
// users/<email>/gems.json files from before the per-gem rewrite) and
// aggregates them for the registry view.
//
// Auth: an OAuth access token (devstorage.read_only scope) is set by
// AuthProvider after the GIS Token Client returns. The SPA NEVER writes —
// only the Chrome extension writes.

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

async function gcsFetch(url: string): Promise<Response> {
  if (!currentAccessToken) {
    throw new GcsError(401, 'No GCS access token available — sign in first.');
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${currentAccessToken}` },
  });

  if (res.status === 401 && onTokenInvalid) {
    const fresh = await onTokenInvalid();
    if (fresh) {
      currentAccessToken = fresh;
      return fetch(url, {
        headers: { Authorization: `Bearer ${fresh}` },
      });
    }
  }
  return res;
}

// Matches either the legacy users/<email>/gems.json file or the new
// per-gem users/<email>/gems/<id>.json objects.
const LEGACY_DOC = /^users\/[^/]+\/gems\.json$/;
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
        if (LEGACY_DOC.test(item.name) || PER_GEM_DOC.test(item.name)) {
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

function ownerEmailFromPath(name: string): string {
  // Matches both "users/<encoded-email>/gems.json" (legacy) and
  // "users/<encoded-email>/gems/<id>.json" (per-gem).
  const match = name.match(/^users\/([^/]+)\//);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// Flatten a list of per-user documents into a Gem[] compatible with the
// existing UI components (which were written against the old Postgres API
// shape).
export async function loadAllGems(bucket: string): Promise<Gem[]> {
  const objectNames = await listUserObjects(bucket);
  const documents = await Promise.all(objectNames.map((name) => downloadObject(bucket, name).then((doc) => ({ name, doc }))));

  const flattened: Gem[] = [];
  for (const { name, doc } of documents) {
    if (!doc || !Array.isArray(doc.gems)) continue;
    const ownerEmail = (doc.owner || ownerEmailFromPath(name)).toLowerCase();
    const owner: GemOwner = {
      id: ownerEmail,
      email: ownerEmail,
      displayName: ownerEmail,
    };
    const updatedAt = doc.updatedAt || new Date(0).toISOString();
    for (const g of doc.gems) {
      flattened.push({
        id: `${ownerEmail}/${g.id}`,
        name: g.name,
        description: g.description || null,
        instructions: g.instructions,
        icon: null,
        source: g.source || 'edit_page',
        status: 'imported',
        geminiId: g.id,
        knowledgeFiles: (g.knowledgeFiles || []).map((k) => ({
          name: k.name,
          type: k.type || '',
          mimeType: k.mimeType || '',
          driveId: k.driveId || null,
          driveUrl: k.driveUrl || null,
        })),
        defaultTools: g.defaultTools || [],
        owner,
        importedAt: updatedAt,
        updatedAt,
        extractedAt: g.extractedAt || null,
        duplicateCluster: null,
      });
    }
  }
  return flattened;
}
