'use strict';

// Set minimal env before config.js loads and validates
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Inject DB mock BEFORE lib/links.js is loaded so the captured `query` reference points here.
// Uses a stable wrapper function so per-test implementations can be swapped via `currentImpl`.
let currentImpl = async () => ({ rows: [], rowCount: 0 });
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: (...args) => currentImpl(...args),
    connectDb: async () => {},
    closeDb: async () => {},
  },
};

// Mock title.js to avoid real HTTP/DNS calls from fetchTitleForUrl
const titlePath = require.resolve('../lib/title');
require.cache[titlePath] = {
  id: titlePath, filename: titlePath, loaded: true,
  exports: { fetchTitle: async () => ({ title: 'Mocked Title', needsManualEntry: false }) },
};

const {
  createLink, readLink, readLinks, updateLink,
  deleteLink, restoreLink, readTagCounts, bulkUpdateStatus,
  parseBookmarksHtml, importLinks, openLink, findDuplicateCandidates, readReviewQueue,
  readUsefulReviewQueue, markUsefulReviewed, mergeLinkNote,
  readRelatedLinks, addRelatedLink, removeRelatedLink,
} = require('../lib/links');

// Helpers

function makeRow(overrides = {}) {
  return {
    id: 'link-id-123',
    url: 'https://example.com',
    title: 'Example',
    host: 'example.com',
    status: 'saved',
    tags: '[]',
    pinned: 0,
    date: '2026-01-01',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    last_opened_at: null,
    opened_count: 0,
    remind_at: null,
    notes: '',
    first_meaningful_at: null,
    first_useful_at: null,
    last_useful_reviewed_at: null,
    ...overrides,
  };
}

// Queue-based mock: each call consumes the next result in the list.
function seq(...results) {
  let i = 0;
  currentImpl = async () => (i < results.length ? results[i++] : { rows: [], rowCount: 0 });
}

// --- Tests ---

describe('parseBookmarksHtml', () => {
  it('extracts links from anchor tags', () => {
    const html = '<a href="https://example.com">Example</a>';
    const result = parseBookmarksHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://example.com');
    assert.equal(result[0].title, 'Example');
    assert.equal(result[0].status, 'saved');
    assert.deepEqual(result[0].tags, []);
  });

  it('skips non-http links', () => {
    const html = '<a href="javascript:void(0)">Skip</a><a href="https://ok.com">OK</a>';
    const result = parseBookmarksHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://ok.com');
  });

  it('uses add_date attribute when present', () => {
    const html = '<a href="https://example.com" ADD_DATE="1000000000">Link</a>';
    const result = parseBookmarksHtml(html);
    assert.equal(result.length, 1);
    assert.ok(result[0].date.startsWith('200'));
  });

  it('falls back to url as title when title is empty', () => {
    const html = '<a href="https://example.com">   </a>';
    const result = parseBookmarksHtml(html);
    assert.equal(result[0].title, 'https://example.com');
  });

  it('returns empty array for html with no valid links', () => {
    assert.deepEqual(parseBookmarksHtml('<p>no links here</p>'), []);
    assert.deepEqual(parseBookmarksHtml(''), []);
  });
});

describe('importLinks', () => {
  it('imports notes', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (args[0].includes('COUNT(*)')) return { rows: [{ count: '1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    await importLinks([{ url: 'https://example.com/imported', notes: 'Imported note' }]);
    const insert = calls.find(([sql]) => sql.includes('INSERT IGNORE'));
    assert.ok(insert[0].includes('notes'));
    assert.ok(insert[1].includes('Imported note'));
  });
});

describe('readLink', () => {
  it('returns a normalized entry for a found row', async () => {
    seq({ rows: [makeRow({ notes: 'Remember this' })], rowCount: 1 });
    const entry = await readLink('link-id-123');
    assert.equal(entry.id, 'link-id-123');
    assert.equal(entry.url, 'https://example.com');
    assert.equal(entry.status, 'saved');
    assert.deepEqual(entry.tags, []);
    assert.equal(entry.pinned, false);
    assert.equal(entry.notes, 'Remember this');
  });

  it('throws 404 when link is not found', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => readLink('nonexistent'), err => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });
});

describe('related links', () => {
  it('reads active links related from either side of a symmetric pair', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { rows: [{ id: 'link-id-123' }], rowCount: 1 };
      return { rows: [makeRow({ id: 'related-id' })], rowCount: 1 };
    };
    const links = await readRelatedLinks('link-id-123');
    assert.deepEqual(links.map(link => link.id), ['related-id']);
    assert.match(calls[1][0], /CASE WHEN r\.link_id_a=\?/);
    assert.match(calls[1][0], /l\.deleted_at IS NULL/);
    assert.doesNotMatch(calls[1][0], /LIMIT/);
  });

  it('rejects related-list reads for missing or archived source links', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => readRelatedLinks('missing'), error => error.statusCode === 404);
  });

  it('stores pairs in canonical order', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { rows: [], rowCount: 1 };
      return { rows: [makeRow({ id: 'a-link' })], rowCount: 1 };
    };
    await addRelatedLink('z-link', 'a-link');
    assert.deepEqual(calls[0][1].slice(0, 2), ['a-link', 'z-link']);
  });

  it('rejects self-links, missing links, and duplicate pairs', async () => {
    await assert.rejects(() => addRelatedLink('same', 'same'), error => error.statusCode === 400);
    await assert.rejects(() => addRelatedLink('one', 'x'.repeat(37)), error => error.statusCode === 400);
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => addRelatedLink('one', 'missing'), error => error.statusCode === 404);
    currentImpl = async () => { throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }); };
    await assert.rejects(() => addRelatedLink('one', 'two'), error => error.statusCode === 409);
  });

  it('removes only the canonical relationship', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return { rows: [], rowCount: 1 };
    };
    await removeRelatedLink('z-link', 'a-link');
    assert.match(calls[0][0], /DELETE FROM link_relationships/);
    assert.deepEqual(calls[0][1], ['a-link', 'z-link']);
    assert.doesNotMatch(calls[0][0], /DELETE FROM links/);
  });
});

describe('readLinks', () => {
  const defaultOpts = {
    whereClause: 'deleted_at IS NULL',
    params: [],
    orderClause: 'updated_at DESC',
    limit: 50,
    skip: 0,
    page: 1,
  };

  it('returns paginated result with links and metadata', async () => {
    seq(
      { rows: [makeRow()], rowCount: 1 },
      { rows: [{ count: '1' }], rowCount: 1 },
    );
    const result = await readLinks(defaultOpts);
    assert.equal(result.links.length, 1);
    assert.equal(result.total, 1);
    assert.equal(result.page, 1);
    assert.equal(result.pages, 1);
  });

  it('returns empty result when no links match', async () => {
    seq(
      { rows: [], rowCount: 0 },
      { rows: [{ count: '0' }], rowCount: 1 },
    );
    const result = await readLinks(defaultOpts);
    assert.equal(result.links.length, 0);
    assert.equal(result.total, 0);
    assert.equal(result.pages, 0);
  });
});

describe('readReviewQueue', () => {
  it('returns at most five due then oldest untouched links', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return { rows: [makeRow({ id: 'due' }), makeRow({ id: 'old' })], rowCount: 2 };
    };
    const links = await readReviewQueue(new Date('2026-06-15T00:00:00.000Z'));
    const [sql, params] = calls[0];
    assert.deepEqual(links.map(link => link.id), ['due', 'old']);
    assert.ok(sql.includes("status IN ('saved', 'unread')"));
    assert.ok(sql.includes("host NOT IN ('youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com')"));
    assert.ok(sql.includes('first_meaningful_at IS NULL'));
    assert.ok(sql.includes('first_meaningful_at < DATE_ADD(created_at, INTERVAL 1 DAY)'));
    assert.ok(sql.includes('remind_at <= ?'));
    assert.ok(sql.includes('created_at <= ?'));
    assert.ok(sql.includes('LIMIT 5'));
    assert.equal(params[0].toISOString(), '2026-06-15T00:00:00.000Z');
    assert.equal(params[1].toISOString(), '2026-06-01T00:00:00.000Z');
  });
});

describe('useful review queue', () => {
  it('returns useful links due after 30 days', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return { rows: [makeRow({ status: 'useful', first_useful_at: '2026-05-01T00:00:00.000Z' })], rowCount: 1 };
    };
    const links = await readUsefulReviewQueue(new Date('2026-06-15T00:00:00.000Z'));
    const [sql, params] = calls[0];
    assert.equal(links[0].status, 'useful');
    assert.ok(sql.includes("status = 'useful'"));
    assert.ok(!sql.includes('first_useful_at IS NOT NULL'));
    assert.ok(sql.includes('COALESCE(last_useful_reviewed_at, first_useful_at, created_at) <= ?'));
    assert.ok(sql.includes('LIMIT 5'));
    assert.equal(params[0].toISOString(), '2026-05-16T00:00:00.000Z');
  });

  it('records a completed useful review', async () => {
    seq(
      { rows: [makeRow({ status: 'useful' })], rowCount: 1 },
      { rows: [], rowCount: 1 },
    );
    const entry = await markUsefulReviewed('link-id-123', {}, new Date('2026-06-15T00:00:00.000Z'));
    assert.equal(entry.lastUsefulReviewedAt, '2026-06-15T00:00:00.000Z');
  });

  it('atomically saves a changed note and completes the review', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return calls.length === 1
        ? { rows: [makeRow({ status: 'useful', notes: 'Old note' })], rowCount: 1 }
        : { rows: [], rowCount: 1 };
    };
    const entry = await markUsefulReviewed(
      'link-id-123',
      { notes: 'New note' },
      new Date('2026-06-15T00:00:00.000Z')
    );
    assert.equal(entry.notes, 'New note');
    assert.match(calls[1][0], /SET notes=\?, last_useful_reviewed_at=\?, updated_at=\?/);
  });

  it('rejects unchanged and oversized useful-review notes', async () => {
    seq({ rows: [makeRow({ status: 'useful', notes: 'Same note' })], rowCount: 1 });
    await assert.rejects(
      () => markUsefulReviewed('link-id-123', { notes: 'Same note' }),
      error => error.statusCode === 400 && error.message === 'Note unchanged'
    );
    await assert.rejects(
      () => markUsefulReviewed('link-id-123', { notes: 'x'.repeat(10001) }),
      error => error.statusCode === 400
    );
  });
});

describe('createLink', () => {
  it('creates and returns a new link with duplicateCandidates', async () => {
    seq(
      { rows: [], rowCount: 0 },  // no existing url match
      { rows: [], rowCount: 1 },  // insert succeeded
      { rows: [], rowCount: 0 },  // findDuplicateCandidates host query
    );
    const { entry, duplicateCandidates } = await createLink({ url: 'https://example.com/new', title: 'New Link' });
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.url.startsWith('https://example.com'));
    assert.equal(entry.title, 'New Link');
    assert.deepEqual(duplicateCandidates, []);
  });

  it('throws 409 on duplicate url', async () => {
    seq({ rows: [{ id: 'existing-id', url: 'https://example.com', deleted_at: null }], rowCount: 1 });
    await assert.rejects(
      () => createLink({ url: 'https://example.com', title: 'Dup' }),
      err => { assert.equal(err.statusCode, 409); return true; }
    );
  });

  it('stores notes with a new link', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return { rows: [], rowCount: 1 };
    };
    const { entry } = await createLink({
      url: 'https://example.com/notes',
      title: 'Notes Link',
      notes: 'Why this matters',
    });
    const insert = calls.find(([sql]) => sql.includes('INSERT INTO links'));
    assert.ok(insert[0].includes('notes'));
    assert.ok(insert[1].includes('Why this matters'));
    assert.equal(entry.notes, 'Why this matters');
  });

  it('sets archived flag in 409 payload when existing link is soft-deleted', async () => {
    seq({ rows: [{ id: 'old-id', url: 'https://example.com', deleted_at: '2026-01-01T00:00:00.000Z' }], rowCount: 1 });
    await assert.rejects(
      () => createLink({ url: 'https://example.com', title: 'Dup' }),
      err => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.payload.archived, true);
        return true;
      }
    );
  });

  it('throws 400 when url is missing', async () => {
    await assert.rejects(() => createLink({ title: 'No URL' }), err => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});

describe('updateLink', () => {
  it('updates fields and returns the updated link', async () => {
    seq(
      { rows: [makeRow()], rowCount: 1 },   // fetch current
      { rows: [], rowCount: 0 },             // no url conflict
      { rows: [], rowCount: 1 },             // update succeeded
    );
    const entry = await updateLink('link-id-123', { title: 'Updated Title' });
    assert.equal(entry.title, 'Updated Title');
  });

  it('throws 404 when link not found', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => updateLink('ghost', { title: 'x' }), err => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('updates notes', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { rows: [makeRow({ notes: 'Old note' })], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    const entry = await updateLink('link-id-123', { notes: 'New note' });
    const update = calls.find(([sql]) => sql.includes('UPDATE links'));
    assert.ok(update[0].includes('notes=?'));
    assert.ok(update[0].includes('first_meaningful_at IS NULL'));
    assert.ok(update[1].includes('New note'));
    assert.equal(update[1].at(-3), 1);
    assert.equal(entry.notes, 'New note');
  });

  it('marks useful as meaningful but not unchanged saves or snoozes', async () => {
    for (const [body, expected] of [
      [{ title: 'Example' }, 0],
      [{ remindAt: '2026-07-01T00:00:00.000Z' }, 0],
      [{ status: 'useful' }, 1],
    ]) {
      const calls = [];
      currentImpl = async (...args) => {
        calls.push(args);
        if (calls.length === 1) return { rows: [makeRow()], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      };
      await updateLink('link-id-123', body);
      const update = calls.find(([sql]) => sql.includes('UPDATE links'));
      assert.equal(update[1].at(-3), expected);
      if (body.status === 'useful') assert.ok(update[0].includes('first_useful_at'));
    }
  });

  it('does not count a note change during the first 24 hours', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) {
        return { rows: [makeRow({ created_at: new Date().toISOString() })], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const entry = await updateLink('link-id-123', { notes: 'Immediate note' });
    const update = calls.find(([sql]) => sql.includes('UPDATE links'));
    assert.equal(update[1].at(-3), 0);
    assert.equal(entry.firstMeaningfulAt, null);
  });

  it('does not count a useful decision during the first 24 hours', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) {
        return { rows: [makeRow({ created_at: new Date().toISOString() })], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const entry = await updateLink('link-id-123', { status: 'useful' });
    const update = calls.find(([sql]) => sql.includes('UPDATE links'));
    assert.equal(update[1].at(-5), 0);
    assert.equal(entry.firstUsefulAt, null);
  });

  it('replaces an early timestamp on a later qualifying action', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          rows: [makeRow({ first_meaningful_at: '2026-01-01T01:00:00.000Z' })],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    };
    const entry = await updateLink('link-id-123', { notes: 'Later note' });
    const update = calls.find(([sql]) => sql.includes('UPDATE links'));
    assert.ok(update[0].includes('first_meaningful_at < DATE_ADD(created_at, INTERVAL 1 DAY)'));
    assert.notEqual(entry.firstMeaningfulAt, '2026-01-01T01:00:00.000Z');
  });

  it('throws 409 when new url conflicts with another link', async () => {
    seq(
      { rows: [makeRow({ url: 'https://old.com' })], rowCount: 1 },
      { rows: [{ id: 'other-id' }], rowCount: 1 },  // url conflict
    );
    await assert.rejects(
      () => updateLink('link-id-123', { url: 'https://taken.com' }),
      err => { assert.equal(err.statusCode, 409); return true; }
    );
  });
});

describe('deleteLink', () => {
  it('soft-deletes a link and returns remaining total', async () => {
    seq(
      { rows: [{ id: 'link-id-123' }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ count: '5' }], rowCount: 1 },
    );
    const result = await deleteLink('link-id-123', { hardDelete: false });
    assert.equal(result.total, 5);
  });

  it('hard-deletes a link', async () => {
    seq(
      { rows: [{ id: 'link-id-123' }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ count: '4' }], rowCount: 1 },
    );
    const result = await deleteLink('link-id-123', { hardDelete: true });
    assert.equal(result.total, 4);
  });

  it('marks soft archive as meaningful', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { rows: [{ id: 'link-id-123' }], rowCount: 1 };
      if (args[0].includes('COUNT(*)')) return { rows: [{ count: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    await deleteLink('link-id-123');
    const update = calls.find(([sql]) => sql.includes('UPDATE links'));
    assert.ok(update[0].includes('created_at <= DATE_SUB(?, INTERVAL 1 DAY)'));
    assert.ok(update[0].includes('first_meaningful_at < DATE_ADD(created_at, INTERVAL 1 DAY)'));
  });

  it('throws 404 when link not found', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => deleteLink('ghost'), err => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });
});

describe('restoreLink', () => {
  it('restores a soft-deleted link and resets status to saved', async () => {
    seq(
      { rows: [makeRow({ status: 'archived', deleted_at: '2026-01-10T00:00:00.000Z' })], rowCount: 1 },
      { rows: [], rowCount: 1 },
    );
    const entry = await restoreLink('link-id-123');
    assert.equal(entry.deletedAt, null);
    assert.equal(entry.status, 'saved');
  });

  it('returns link unchanged when it is not deleted', async () => {
    seq({ rows: [makeRow({ deleted_at: null })], rowCount: 1 });
    const entry = await restoreLink('link-id-123');
    assert.equal(entry.deletedAt, null);
  });

  it('throws 404 when link not found', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => restoreLink('ghost'), err => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });
});

describe('readTagCounts', () => {
  it('returns tag list with numeric counts', async () => {
    seq({ rows: [{ tag: 'js', count: '5' }, { tag: 'css', count: '3' }], rowCount: 2 });
    const tags = await readTagCounts(10);
    assert.equal(tags.length, 2);
    assert.equal(tags[0].tag, 'js');
    assert.equal(tags[0].count, 5);
    assert.equal(typeof tags[0].count, 'number');
  });

  it('returns empty array when no tags exist', async () => {
    seq({ rows: [], rowCount: 0 });
    const tags = await readTagCounts(10);
    assert.deepEqual(tags, []);
  });
});

describe('bulkUpdateStatus', () => {
  it('updates status for given ids and returns updated count', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      return { rows: [], rowCount: 3 };
    };
    const result = await bulkUpdateStatus(['id1', 'id2', 'id3'], 'useful');
    assert.equal(result.updated, 3);
    assert.ok(calls[0][0].includes('created_at <= DATE_SUB(?, INTERVAL 1 DAY)'));
    assert.ok(calls[0][0].includes('first_meaningful_at < DATE_ADD(created_at, INTERVAL 1 DAY)'));
    assert.ok(calls[0][0].includes('first_useful_at'));
    assert.ok(calls[0][0].includes('created_at <= DATE_SUB(?, INTERVAL 1 DAY)'));
  });

  it('throws 400 for empty ids array', async () => {
    await assert.rejects(() => bulkUpdateStatus([], 'saved'), err => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  it('throws 400 when ids exceed 200', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`);
    await assert.rejects(() => bulkUpdateStatus(ids, 'saved'), err => {
      assert.equal(err.statusCode, 400);
      return true;
    });
  });
});

describe('openLink', () => {
  it('increments opened_count and sets last_opened_at, returns updated entry', async () => {
    const updated = makeRow({ opened_count: 1, last_opened_at: '2026-06-01T00:00:00.000Z' });
    seq(
      { rows: [makeRow()], rowCount: 1 },  // existence check
      { rows: [], rowCount: 1 },            // UPDATE
      { rows: [updated], rowCount: 1 },     // re-fetch
    );
    const entry = await openLink('link-id-123');
    assert.equal(entry.openedCount, 1);
    assert.ok(entry.lastOpenedAt);
  });

  it('throws 404 when link not found', async () => {
    seq({ rows: [], rowCount: 0 });
    await assert.rejects(() => openLink('ghost'), err => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });
});

describe('findDuplicateCandidates', () => {
  it('returns empty array when no links on same host', async () => {
    seq({ rows: [], rowCount: 0 });
    const candidates = await findDuplicateCandidates('https://example.com/page', 'Example Page');
    assert.deepEqual(candidates, []);
  });

  it('rejects an invalid duplicate-check URL', async () => {
    await assert.rejects(
      () => findDuplicateCandidates('not-a-url', 'Bad URL'),
      error => error.statusCode === 400
    );
    await assert.rejects(
      () => findDuplicateCandidates('file:///etc/passwd', 'Local file'),
      error => error.statusCode === 400
    );
  });

  it('returns candidates above similarity threshold', async () => {
    seq({
      rows: [
        { id: 'link-2', url: 'https://example.com/page2', title: 'Example Page - Updated' },
      ],
      rowCount: 1,
    });
    const candidates = await findDuplicateCandidates('https://example.com/new', 'Example Page');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, 'link-2');
    assert.ok(candidates[0].similarity >= 0.75);
  });

  it('excludes candidates below similarity threshold', async () => {
    seq({
      rows: [
        { id: 'link-3', url: 'https://example.com/other', title: 'Completely Unrelated Topic' },
      ],
      rowCount: 1,
    });
    const candidates = await findDuplicateCandidates('https://example.com/new', 'Introduction to Python');
    assert.deepEqual(candidates, []);
  });

  it('sorts candidates by similarity descending', async () => {
    seq({
      rows: [
        { id: 'link-a', url: 'https://example.com/a', title: 'Example Page Summary' },
        { id: 'link-b', url: 'https://example.com/b', title: 'Example Page' },
      ],
      rowCount: 2,
    });
    const candidates = await findDuplicateCandidates('https://example.com/new', 'Example Page');
    assert.equal(candidates.length, 2);
    assert.ok(candidates[0].similarity >= candidates[1].similarity);
  });

  it('returns exact and archived matches before fuzzy matches', async () => {
    seq({
      rows: [
        { id: 'fuzzy', url: 'https://example.com/guide', title: 'Example Guide Updated', deleted_at: null },
        { id: 'exact', url: 'https://example.com/page', title: 'Old title', deleted_at: '2026-01-01T00:00:00.000Z' },
      ],
      rowCount: 2,
    });
    const candidates = await findDuplicateCandidates('https://example.com/page?utm_source=test', 'Example Guide');
    assert.deepEqual(candidates[0], {
      id: 'exact',
      url: 'https://example.com/page',
      title: 'Old title',
      similarity: 1,
      exact: true,
      archived: true,
    });
    assert.equal(candidates[1].exact, false);
    assert.equal(candidates[1].archived, false);
  });

  it('excludes the newly created link from post-save suggestions', async () => {
    seq({ rows: [makeRow({ id: 'new-id', url: 'https://example.com/page' })], rowCount: 1 });
    const candidates = await findDuplicateCandidates('https://example.com/page', 'Example', 'new-id');
    assert.deepEqual(candidates, []);
  });
});

describe('mergeLinkNote', () => {
  it('atomically appends a note fragment', async () => {
    const calls = [];
    currentImpl = async (...args) => {
      calls.push(args);
      if (calls.length === 1) return { rows: [], rowCount: 1 };
      return { rows: [makeRow({ notes: ' Existing \n\nNew insight' })], rowCount: 1 };
    };
    const entry = await mergeLinkNote('link-id-123', 'New insight');
    assert.match(calls[0][0], /^UPDATE links/);
    assert.match(calls[0][0], /CONCAT/);
    assert.doesNotMatch(calls[0][0], /TRIM/);
    assert.equal(entry.notes, 'Existing \n\nNew insight');
  });

  it('rejects note fragments beyond the stored limit', async () => {
    await assert.rejects(
      () => mergeLinkNote('link-id-123', 'x'.repeat(10_001)),
      error => error.statusCode === 400
    );
  });
});
