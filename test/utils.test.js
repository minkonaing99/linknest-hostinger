'use strict';

// Set minimal env before config.js loads and validates
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUrl, deriveHost, normalizeStatus, normalizeTags,
  parseBooleanFlag, parsePositiveInt, ensurePlainObject,
  parseLinkListQuery, sanitizeEntry, normalizeStoredEntry, isPrivateIp,
} = require('../lib/utils');

describe('normalizeUrl', () => {
  it('strips utm_* tracking params', () => {
    const result = normalizeUrl('https://example.com/path?utm_source=newsletter&utm_medium=email&keep=this');
    const url = new URL(result);
    assert.equal(url.searchParams.has('utm_source'), false);
    assert.equal(url.searchParams.has('utm_medium'), false);
    assert.equal(url.searchParams.get('keep'), 'this');
  });

  it('strips fbclid, gclid and other legacy noisy params', () => {
    const result = normalizeUrl('https://example.com/?q=test&fbclid=abc&gclid=xyz');
    const url = new URL(result);
    assert.equal(url.searchParams.has('fbclid'), false);
    assert.equal(url.searchParams.has('gclid'), false);
    assert.equal(url.searchParams.get('q'), 'test');
  });

  it('strips new tracking params: mc_cid, _ga, msclkid, dclid, yclid, twclid, ttclid, sccid, ref_url', () => {
    const input = 'https://example.com/?keep=yes&mc_cid=1&_ga=2&msclkid=3&dclid=4&yclid=5&twclid=6&ttclid=7&sccid=8&ref_url=9';
    const result = normalizeUrl(input);
    const url = new URL(result);
    assert.equal(url.searchParams.get('keep'), 'yes');
    for (const p of ['mc_cid', '_ga', 'msclkid', 'dclid', 'yclid', 'twclid', 'ttclid', 'sccid', 'ref_url']) {
      assert.equal(url.searchParams.has(p), false, `${p} should be stripped`);
    }
  });

  it('removes hash fragment', () => {
    const result = normalizeUrl('https://example.com/page#section-2');
    assert.ok(!result.includes('#'));
  });

  it('strips trailing slash from non-root path', () => {
    assert.equal(normalizeUrl('https://example.com/foo/'), 'https://example.com/foo');
    assert.equal(normalizeUrl('https://example.com/foo/bar/'), 'https://example.com/foo/bar');
  });

  it('preserves root slash', () => {
    const result = normalizeUrl('https://example.com/');
    assert.equal(new URL(result).pathname, '/');
  });

  it('sorts remaining query params for canonical form', () => {
    const a = normalizeUrl('https://example.com/?z=1&a=2');
    const b = normalizeUrl('https://example.com/?a=2&z=1');
    assert.equal(a, b);
  });

  it('clears all query params on auth-like paths', () => {
    const result = normalizeUrl('https://auth.example.com/login?code=abc&state=xyz');
    const url = new URL(result);
    assert.equal(url.search, '');
  });

  it('preserves meaningful query params', () => {
    const result = normalizeUrl('https://example.com/search?q=hello+world&page=2');
    const url = new URL(result);
    assert.equal(url.searchParams.get('q'), 'hello world');
    assert.equal(url.searchParams.get('page'), '2');
  });

  it('throws on invalid URL', () => {
    assert.throws(() => normalizeUrl('not-a-url'));
  });
});

describe('deriveHost', () => {
  it('strips www prefix', () => {
    assert.equal(deriveHost('https://www.example.com/path'), 'example.com');
  });

  it('returns hostname for non-www domains', () => {
    assert.equal(deriveHost('https://api.example.com'), 'api.example.com');
  });

  it('returns empty string for invalid url', () => {
    assert.equal(deriveHost('not-valid'), '');
  });
});

describe('normalizeStatus', () => {
  it('returns known statuses unchanged', () => {
    for (const s of ['unread', 'saved', 'useful', 'archived']) {
      assert.equal(normalizeStatus(s), s);
    }
  });

  it('defaults unknown values to saved', () => {
    assert.equal(normalizeStatus(''), 'saved');
    assert.equal(normalizeStatus('pending'), 'saved');
    assert.equal(normalizeStatus(undefined), 'saved');
  });
});

describe('normalizeTags', () => {
  it('deduplicates tags', () => {
    assert.deepEqual(normalizeTags(['a', 'b', 'a']), ['a', 'b']);
  });

  it('trims whitespace', () => {
    assert.deepEqual(normalizeTags(['  foo  ', ' bar']), ['foo', 'bar']);
  });

  it('filters empty strings', () => {
    assert.deepEqual(normalizeTags(['a', '', '  ', 'b']), ['a', 'b']);
  });

  it('accepts comma-separated string input', () => {
    assert.deepEqual(normalizeTags('a, b, c'), ['a', 'b', 'c']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(normalizeTags([]), []);
    assert.deepEqual(normalizeTags(''), []);
  });
});

describe('parseBooleanFlag', () => {
  it('returns true for truthy string values', () => {
    for (const v of ['1', 'true', 'yes', 'on']) {
      assert.equal(parseBooleanFlag(v), true, `expected true for "${v}"`);
    }
  });

  it('returns false for falsy string values', () => {
    for (const v of ['0', 'false', 'no', 'off']) {
      assert.equal(parseBooleanFlag(v), false, `expected false for "${v}"`);
    }
  });

  it('returns default for null/undefined/empty', () => {
    assert.equal(parseBooleanFlag(null, false), false);
    assert.equal(parseBooleanFlag(null, true), true);
    assert.equal(parseBooleanFlag(undefined, false), false);
    assert.equal(parseBooleanFlag('', false), false);
  });

  it('returns default for unrecognized values', () => {
    assert.equal(parseBooleanFlag('maybe', false), false);
    assert.equal(parseBooleanFlag('maybe', true), true);
  });
});

describe('parsePositiveInt', () => {
  it('parses valid integers', () => {
    assert.equal(parsePositiveInt('5', 1), 5);
    assert.equal(parsePositiveInt('100', 1), 100);
  });

  it('clamps to min', () => {
    assert.equal(parsePositiveInt('0', 1, 1), 1);
    assert.equal(parsePositiveInt('-5', 1, 1), 1);
  });

  it('clamps to max', () => {
    assert.equal(parsePositiveInt('1000', 1, 1, 200), 200);
  });

  it('returns fallback for invalid input', () => {
    assert.equal(parsePositiveInt('abc', 10), 10);
    assert.equal(parsePositiveInt(null, 5), 5);
    assert.equal(parsePositiveInt('', 7), 7);
  });
});

describe('ensurePlainObject', () => {
  it('passes plain objects through', () => {
    const obj = { a: 1 };
    assert.equal(ensurePlainObject(obj), obj);
  });

  it('throws on null', () => {
    assert.throws(() => ensurePlainObject(null));
  });

  it('throws on array', () => {
    assert.throws(() => ensurePlainObject([1, 2, 3]));
  });

  it('throws on string', () => {
    assert.throws(() => ensurePlainObject('string'));
  });
});

describe('sanitizeEntry', () => {
  const base = {
    url: 'https://example.com/article',
    title: 'Test Title',
    date: '2026-01-15',
    status: 'unread',
    tags: ['js', 'testing'],
  };

  it('returns a valid entry for good input', () => {
    const entry = sanitizeEntry(base);
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.id.length > 0);
    assert.equal(entry.title, 'Test Title');
    assert.equal(entry.status, 'unread');
    assert.deepEqual(entry.tags, ['js', 'testing']);
    assert.ok(entry.createdAt);
    assert.ok(entry.updatedAt);
    assert.equal(entry.deletedAt, null);
  });

  it('throws when url is missing', () => {
    assert.throws(() => sanitizeEntry({ ...base, url: '' }), /URL is required/);
  });

  it('throws on invalid url', () => {
    assert.throws(() => sanitizeEntry({ ...base, url: 'not-a-url' }), /valid absolute URL/);
  });

  it('throws on invalid date format', () => {
    assert.throws(() => sanitizeEntry({ ...base, date: '15-01-2026' }), /YYYY-MM-DD/);
  });

  it('throws when title exceeds max length', () => {
    assert.throws(() => sanitizeEntry({ ...base, title: 'x'.repeat(301) }), /title must be/);
  });

  it('throws when tags exceed max count', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    assert.throws(() => sanitizeEntry({ ...base, tags: tooMany }), /tags must contain/);
  });

  it('throws when a tag exceeds max length', () => {
    assert.throws(() => sanitizeEntry({ ...base, tags: ['x'.repeat(51)] }), /each tag must be/);
  });

  it('preserves existing createdAt from options.existing', () => {
    const existingCreatedAt = '2025-01-01T00:00:00.000Z';
    const entry = sanitizeEntry(base, { existing: { createdAt: existingCreatedAt } });
    assert.equal(entry.createdAt, existingCreatedAt);
  });

  it('uses provided id if given', () => {
    const entry = sanitizeEntry({ ...base, id: 'my-custom-id' });
    assert.equal(entry.id, 'my-custom-id');
  });

  it('defaults status to saved for unknown value', () => {
    const entry = sanitizeEntry({ ...base, status: 'invalid' });
    assert.equal(entry.status, 'saved');
  });

  it('strips tracking params from url', () => {
    const entry = sanitizeEntry({ ...base, url: 'https://example.com/article?utm_source=test' });
    assert.ok(!entry.url.includes('utm_source'));
  });

  it('derives host from url, stripping www', () => {
    const entry = sanitizeEntry({ ...base, url: 'https://www.github.com/org/repo' });
    assert.equal(entry.host, 'github.com');
  });
});

describe('normalizeStoredEntry', () => {
  it('fills in missing fields with defaults', () => {
    const entry = normalizeStoredEntry({ url: 'https://example.com' });
    assert.equal(typeof entry.id, 'string');
    assert.equal(entry.title, 'https://example.com');
    assert.equal(entry.status, 'saved');
    assert.equal(entry.pinned, false);
    assert.deepEqual(entry.tags, []);
  });

  it('normalizes unknown status to saved', () => {
    const entry = normalizeStoredEntry({ url: 'https://x.com', status: 'invalid' });
    assert.equal(entry.status, 'saved');
  });

  it('coerces pinned to boolean', () => {
    assert.equal(normalizeStoredEntry({ url: 'https://x.com', pinned: 1 }).pinned, true);
    assert.equal(normalizeStoredEntry({ url: 'https://x.com', pinned: 0 }).pinned, false);
  });

  it('normalizes array tags', () => {
    const entry = normalizeStoredEntry({ url: 'https://x.com', tags: ['a', 'b'] });
    assert.deepEqual(entry.tags, ['a', 'b']);
  });

  it('includes retention fields with correct defaults', () => {
    const entry = normalizeStoredEntry({ url: 'https://x.com' });
    assert.equal(entry.lastOpenedAt, null);
    assert.equal(entry.openedCount, 0);
    assert.equal(entry.remindAt, null);
  });

  it('passes through retention field values', () => {
    const ts = '2026-06-01T10:00:00.000Z';
    const entry = normalizeStoredEntry({ url: 'https://x.com', lastOpenedAt: ts, openedCount: 3, remindAt: ts });
    assert.equal(entry.lastOpenedAt, ts);
    assert.equal(entry.openedCount, 3);
    assert.equal(entry.remindAt, ts);
  });
});

describe('sanitizeEntry — remindAt', () => {
  const base = { url: 'https://example.com', title: 'T', date: '2026-01-01' };

  it('passes null remindAt through as null', () => {
    const entry = sanitizeEntry({ ...base, remindAt: null });
    assert.equal(entry.remindAt, null);
  });

  it('passes empty string remindAt as null', () => {
    const entry = sanitizeEntry({ ...base, remindAt: '' });
    assert.equal(entry.remindAt, null);
  });

  it('accepts a valid ISO datetime string', () => {
    const entry = sanitizeEntry({ ...base, remindAt: '2026-12-01T00:00:00.000Z' });
    assert.equal(entry.remindAt, '2026-12-01T00:00:00.000Z');
  });

  it('throws 400 for an invalid remindAt value', () => {
    assert.throws(() => sanitizeEntry({ ...base, remindAt: 'not-a-date' }), err => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});

describe('isPrivateIp', () => {
  it('detects loopback addresses', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('127.0.0.254'), true);
    assert.equal(isPrivateIp('::1'), true);
  });

  it('detects RFC-1918 private ranges', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.255'), true);
  });

  it('detects AWS metadata link-local address', () => {
    assert.equal(isPrivateIp('169.254.169.254'), true);
  });

  it('allows public IPs', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
    assert.equal(isPrivateIp('104.26.10.228'), false);
  });
});

describe('parseLinkListQuery', () => {
  function p(obj) { return new URLSearchParams(obj); }

  it('returns defaults for empty params', () => {
    const q = parseLinkListQuery(p({}));
    assert.equal(q.page, 1);
    assert.equal(q.limit, 50);
    assert.equal(q.skip, 0);
    assert.equal(q.includeDeleted, false);
    assert.equal(q.sortField, 'updatedAt');
    assert.equal(q.sortOrder, 'desc');
  });

  it('builds status filter', () => {
    const q = parseLinkListQuery(p({ status: 'unread' }));
    assert.ok(q.whereClause.includes('status = ?'));
    assert.ok(q.params.includes('unread'));
  });

  it('handles deleted as special status', () => {
    const q = parseLinkListQuery(p({ status: 'deleted' }));
    assert.ok(q.whereClause.includes('deleted_at IS NOT NULL'));
    assert.ok(!q.whereClause.includes('status = ?'));
  });

  it('builds tag filter', () => {
    const q = parseLinkListQuery(p({ tag: 'javascript' }));
    assert.ok(q.whereClause.includes('JSON_CONTAINS'));
    assert.ok(q.params.includes('javascript'));
  });

  it('builds full-text search filter', () => {
    const q = parseLinkListQuery(p({ q: 'react hooks' }));
    assert.ok(q.whereClause.includes('LIKE ?'));
    assert.equal(q.query, 'react hooks');
  });

  it('calculates correct pagination offset', () => {
    const q = parseLinkListQuery(p({ page: '3', limit: '20' }));
    assert.equal(q.page, 3);
    assert.equal(q.limit, 20);
    assert.equal(q.skip, 40);
  });

  it('clamps limit to configured max', () => {
    const q = parseLinkListQuery(p({ limit: '9999' }));
    assert.equal(q.limit, 200);
  });

  it('includes deleted rows when includeDeleted is true', () => {
    const q = parseLinkListQuery(p({ includeDeleted: 'true' }));
    assert.equal(q.includeDeleted, true);
    assert.ok(!q.whereClause.includes('deleted_at IS NULL'));
  });

  it('applies updatedAfter filter', () => {
    const q = parseLinkListQuery(p({ updatedAfter: '2026-01-01T00:00:00.000Z' }));
    assert.ok(q.whereClause.includes('updated_at > ?'));
  });

  it('applies remindBefore filter', () => {
    const q = parseLinkListQuery(p({ remindBefore: '2026-06-01T00:00:00.000Z' }));
    assert.ok(q.whereClause.includes('remind_at IS NOT NULL'));
    assert.ok(q.whereClause.includes('remind_at <= ?'));
  });

  it('applies staleBefore filter', () => {
    const q = parseLinkListQuery(p({ staleBefore: '2026-05-01T00:00:00.000Z' }));
    assert.ok(q.whereClause.includes('last_opened_at < ?'));
    assert.ok(q.whereClause.includes('last_opened_at IS NULL'));
  });

  it('applies neverOpened filter', () => {
    const q = parseLinkListQuery(p({ neverOpened: 'true' }));
    assert.ok(q.whereClause.includes('opened_count = 0'));
  });
});
