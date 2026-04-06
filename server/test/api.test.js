import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import migrate from '../db/migrate.js';

// These integration tests require a running PostgreSQL database.
// Run via: make api-test (which executes inside the Docker Compose container)

async function truncateAll() {
  await pool.query('DELETE FROM duplicate_cluster_members');
  await pool.query('DELETE FROM duplicate_clusters');
  await pool.query('DELETE FROM gems');
  await pool.query('DELETE FROM users');
}

// Minimal HTTP helper — avoids depending on a test HTTP client library
const BASE = `http://localhost:${process.env.PORT || 9090}`;

async function api(method, path, { body, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

describe('API integration tests', () => {
  before(async () => {
    await migrate(pool);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  after(async () => {
    await truncateAll();
    await pool.end();
  });

  describe('GET /api/health', () => {
    it('returns ok', async () => {
      const { status, json } = await api('GET', '/api/health');
      assert.equal(status, 200);
      assert.equal(json.status, 'ok');
    });
  });

  describe('POST /api/gems/import', () => {
    it('imports a gem and returns counts', async () => {
      const { status, json } = await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'Test Gem', instructions: 'You are a helpful assistant.' }] },
      });
      assert.equal(status, 200);
      assert.equal(json.imported, 1);
      assert.equal(json.skipped, 0);
      assert.equal(json.importedIds.length, 1);
    });

    it('skips duplicate import (same user, same instructions)', async () => {
      const gem = { name: 'Test Gem', instructions: 'You are a helpful assistant.' };
      await api('POST', '/api/gems/import', { body: { gems: [gem] } });
      const { json } = await api('POST', '/api/gems/import', { body: { gems: [gem] } });
      assert.equal(json.imported, 0);
      assert.equal(json.skipped, 1);
    });

    it('rejects empty gems array', async () => {
      const { status } = await api('POST', '/api/gems/import', { body: { gems: [] } });
      assert.equal(status, 400);
    });

    it('rejects gem without instructions', async () => {
      const { status } = await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'No Instructions' }] },
      });
      assert.equal(status, 400);
    });
  });

  describe('GET /api/gems', () => {
    it('returns imported gems with pagination', async () => {
      await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'Gem A', instructions: 'Instructions for Gem A' }] },
      });

      const { status, json } = await api('GET', '/api/gems');
      assert.equal(status, 200);
      assert.equal(json.gems.length, 1);
      assert.equal(json.gems[0].name, 'Gem A');
      assert.equal(json.pagination.total, 1);
    });

    it('supports full-text search', async () => {
      await api('POST', '/api/gems/import', {
        body: {
          gems: [
            { name: 'Code Reviewer', instructions: 'You review code for bugs and style issues.' },
            { name: 'Recipe Helper', instructions: 'You help users find and create recipes.' },
          ],
        },
      });

      const { json } = await api('GET', '/api/gems?q=code+review');
      assert.equal(json.gems.length, 1);
      assert.equal(json.gems[0].name, 'Code Reviewer');
    });
  });

  describe('GET /api/gems/:id', () => {
    it('returns a single gem', async () => {
      const importRes = await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'Detail Gem', instructions: 'Detailed instructions here.' }] },
      });
      const id = importRes.json.importedIds[0];

      const { status, json } = await api('GET', `/api/gems/${id}`);
      assert.equal(status, 200);
      assert.equal(json.name, 'Detail Gem');
      assert.equal(json.duplicateCluster, null);
    });

    it('returns 404 for non-existent gem', async () => {
      const { status } = await api('GET', '/api/gems/00000000-0000-0000-0000-000000000000');
      assert.equal(status, 404);
    });
  });

  describe('PATCH /api/gems/:id', () => {
    it('updates gem name', async () => {
      const importRes = await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'Old Name', instructions: 'Some instructions.' }] },
      });
      const id = importRes.json.importedIds[0];

      const { status, json } = await api('PATCH', `/api/gems/${id}`, {
        body: { name: 'New Name' },
      });
      assert.equal(status, 200);
      assert.equal(json.name, 'New Name');
    });
  });

  describe('DELETE /api/gems/:id', () => {
    it('deletes a gem', async () => {
      const importRes = await api('POST', '/api/gems/import', {
        body: { gems: [{ name: 'Delete Me', instructions: 'To be deleted.' }] },
      });
      const id = importRes.json.importedIds[0];

      const { status } = await api('DELETE', `/api/gems/${id}`);
      assert.equal(status, 204);

      const { status: getStatus } = await api('GET', `/api/gems/${id}`);
      assert.equal(getStatus, 404);
    });
  });

  describe('GET /api/users/me', () => {
    it('returns current user profile', async () => {
      const { status, json } = await api('GET', '/api/users/me');
      assert.equal(status, 200);
      assert.equal(json.email, 'dev@localhost');
    });
  });

  describe('GET /api/stats', () => {
    it('returns org-wide statistics', async () => {
      const { status, json } = await api('GET', '/api/stats');
      assert.equal(status, 200);
      assert.equal(json.totalGems, 0);
      assert.equal(json.uniqueGems, 0);
      assert.equal(json.duplicateClusters, 0);
    });
  });
});
