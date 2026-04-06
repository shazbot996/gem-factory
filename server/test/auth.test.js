import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Test auth middleware in dev bypass mode (no GOOGLE_CLIENT_ID set)
// We import dynamically to control env before the module loads

describe('auth middleware (dev bypass)', () => {
  let authMiddleware;

  beforeEach(async () => {
    // Ensure dev mode — GOOGLE_CLIENT_ID should be empty
    delete process.env.GOOGLE_CLIENT_ID;
    // Re-import fresh module — but since ESM caches, we test the already-loaded behavior
    // The module reads env at import time. In the test container, GOOGLE_CLIENT_ID is empty.
    const mod = await import('../middleware/auth.js');
    authMiddleware = mod.default;
  });

  it('sets default dev user when no header', async () => {
    const req = { path: '/api/gems', headers: {} };
    const res = {};
    let called = false;
    const next = () => { called = true; };

    await authMiddleware(req, res, next);
    assert.equal(called, true);
    assert.equal(req.user.email, 'dev@localhost');
    assert.equal(req.user.name, 'Dev User');
  });

  it('uses X-Dev-User-Email header when provided', async () => {
    const req = { path: '/api/gems', headers: { 'x-dev-user-email': 'alice@test.com' } };
    const res = {};
    let called = false;
    const next = () => { called = true; };

    await authMiddleware(req, res, next);
    assert.equal(called, true);
    assert.equal(req.user.email, 'alice@test.com');
  });

  it('skips auth for health check', async () => {
    const req = { path: '/api/health', headers: {} };
    const res = {};
    let called = false;
    const next = () => { called = true; };

    await authMiddleware(req, res, next);
    assert.equal(called, true);
    assert.equal(req.user, undefined);
  });
});
