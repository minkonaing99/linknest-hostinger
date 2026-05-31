#!/usr/bin/env node
'use strict';

// Audits all link URLs against the current normalizeUrl rules.
// Prints which URLs would change and flags duplicate candidates.
// Does NOT modify any data — read-only.

require('dotenv').config();

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'placeholder-not-used-by-this-script-xxxxxxxxxxxxxxx';
}

const { query, connectDb, closeDb } = require('../lib/db');
const { normalizeUrl } = require('../lib/utils');

async function run() {
  await connectDb();

  const res = await query('SELECT id, url FROM links ORDER BY created_at ASC');
  const rows = res.rows;
  console.log(`\nScanning ${rows.length} links...\n`);

  const changed = [];
  const errors = [];
  const seenNormalized = new Map();  // normalized url -> id of first row with that form
  let duplicateCount = 0;

  for (const row of rows) {
    let normalized;
    try {
      normalized = normalizeUrl(row.url);
    } catch {
      errors.push({ id: row.id, url: row.url });
      continue;
    }

    if (normalized !== row.url) {
      changed.push({ id: row.id, from: row.url, to: normalized });
    }

    if (seenNormalized.has(normalized)) {
      duplicateCount++;
      console.log('DUPLICATE CANDIDATE');
      console.log(`  id:       ${row.id}`);
      console.log(`  url:      ${row.url}`);
      console.log(`  conflicts with id: ${seenNormalized.get(normalized)}`);
      console.log(`  shared canonical:  ${normalized}`);
      console.log('');
    } else {
      seenNormalized.set(normalized, row.id);
    }
  }

  if (changed.length > 0) {
    console.log(`=== ${changed.length} URL(s) would change ===\n`);
    for (const c of changed) {
      console.log(`  id:   ${c.id}`);
      console.log(`  from: ${c.from}`);
      console.log(`  to:   ${c.to}`);
      console.log('');
    }
  } else {
    console.log('No URL changes needed.\n');
  }

  if (errors.length > 0) {
    console.log(`=== ${errors.length} URL(s) failed to parse ===\n`);
    for (const e of errors) {
      console.log(`  id:  ${e.id}`);
      console.log(`  url: ${e.url}`);
    }
    console.log('');
  }

  console.log(`Summary: ${rows.length} total | ${changed.length} would change | ${duplicateCount} duplicate candidates | ${errors.length} errors`);

  await closeDb();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
