'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

let queryCall;
let queryRow = {};
const dbPath = require.resolve('../../lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (...args) => {
      queryCall = args;
      return { rows: [queryRow], rowCount: 1 };
    },
  },
};

const linksPath = require.resolve('../../lib/links');
require.cache[linksPath] = {
  id: linksPath, filename: linksPath, loaded: true,
  exports: { readTagCounts: async () => [], fetchTitleForUrl: async () => ({}) },
};

const { handleStats } = require('../../lib/routes/meta');

function response() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

describe('GET /api/stats revisit measurement', () => {
  it('returns fair 30-day cohorts and percentage-point target', async () => {
    queryRow = {
      total: 12, unread: 3, saved: 4, useful: 2, archived: 1,
      current_eligible: 10, current_meaningful: 4,
      previous_eligible: 8, previous_meaningful: 2,
    };
    const res = response();

    await handleStats({}, res, new Date('2026-09-09T00:00:00.000Z'));

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.revisit, {
      windowDays: 30,
      minimumAgeDays: 14,
      current: { eligible: 10, meaningful: 4, rate: 40 },
      previous: { eligible: 8, meaningful: 2, rate: 25 },
      percentagePointChange: 15,
      targetRate: 45,
      buildingBaseline: false,
    });
    assert.ok(queryCall[0].includes('first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY)'));
    assert.ok(queryCall[0].includes('created_at >= ? AND created_at < ?'));
    assert.deepEqual(queryCall[1].map(value => value.toISOString()), [
      '2026-07-27T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
      '2026-06-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z',
      '2026-06-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z',
    ]);
  });

  it('reports baseline building until previous cohort exists', async () => {
    queryRow = { current_eligible: 2, current_meaningful: 0 };
    const res = response();

    await handleStats({}, res, new Date('2026-09-09T00:00:00.000Z'));

    assert.equal(res.body.revisit.current.rate, 0);
    assert.equal(res.body.revisit.previous.rate, null);
    assert.equal(res.body.revisit.percentagePointChange, null);
    assert.equal(res.body.revisit.targetRate, null);
    assert.equal(res.body.revisit.buildingBaseline, true);
  });
});
