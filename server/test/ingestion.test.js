import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hash } from '../services/ingestion.js';

describe('normalize', () => {
  it('trims whitespace', () => {
    assert.equal(normalize('  hello  '), 'hello');
  });

  it('converts CRLF to LF', () => {
    assert.equal(normalize('a\r\nb'), 'a\nb');
  });

  it('converts bare CR to LF', () => {
    assert.equal(normalize('a\rb'), 'a\nb');
  });

  it('collapses 3+ newlines to 2', () => {
    assert.equal(normalize('a\n\n\n\nb'), 'a\n\nb');
  });

  it('preserves double newlines', () => {
    assert.equal(normalize('a\n\nb'), 'a\n\nb');
  });
});

describe('hash', () => {
  it('returns a 64-char hex string', () => {
    const h = hash('test');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    assert.equal(hash('hello world'), hash('hello world'));
  });

  it('produces different hashes for different inputs', () => {
    assert.notEqual(hash('a'), hash('b'));
  });
});
