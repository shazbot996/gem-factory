import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isIdentityAllowed } from '../middleware/auth.js';

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

describe('isIdentityAllowed (Gmail + customer org)', () => {
  const ORG = 'customer-org.example';

  it('accepts a customer-org token (hd matches ALLOWED_DOMAIN)', () => {
    const payload = { email: 'alice@customer-org.example', hd: ORG };
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: true }),
      true,
    );
  });

  it('accepts a customer-org token even when allowGmail is false', () => {
    const payload = { email: 'alice@customer-org.example', hd: ORG };
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: false }),
      true,
    );
  });

  it('accepts a personal Gmail token when allowGmail is true', () => {
    const payload = { email: 'user@gmail.com' }; // no hd claim
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: true }),
      true,
    );
  });

  it('rejects a personal Gmail token when allowGmail is false', () => {
    const payload = { email: 'user@gmail.com' }; // no hd claim
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: false }),
      false,
    );
  });

  it('rejects a third-party org domain (hd does not match)', () => {
    const payload = { email: 'bob@some-other-org.example', hd: 'some-other-org.example' };
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: true }),
      false,
    );
  });

  it('rejects a non-Gmail personal account (no hd, not @gmail.com)', () => {
    const payload = { email: 'user@yahoo.com' };
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: true }),
      false,
    );
  });

  it('rejects everything when allowedDomain is unset and allowGmail is false', () => {
    const gmail = { email: 'user@gmail.com' };
    const org = { email: 'alice@customer-org.example', hd: 'customer-org.example' };
    assert.equal(
      isIdentityAllowed(gmail, { allowedDomain: '', allowGmail: false }),
      false,
    );
    assert.equal(
      isIdentityAllowed(org, { allowedDomain: '', allowGmail: false }),
      false,
    );
  });

  it('accepts Gmail with any case variation of the domain', () => {
    const payload = { email: 'USER@Gmail.COM' };
    assert.equal(
      isIdentityAllowed(payload, { allowedDomain: ORG, allowGmail: true }),
      true,
    );
  });
});
