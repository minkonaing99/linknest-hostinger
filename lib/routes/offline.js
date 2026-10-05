'use strict';

const { sendJson } = require('../http');
const { offlineSnapshot } = require('../offline-library');

async function handle(req, res, reqUrl) {
  if (req.method !== 'GET' || !/^\/api\/(?:v1\/)?links\/offline-snapshot$/.test(reqUrl.pathname)) return false;
  const headers = { 'Cache-Control': 'private, no-store' };
  if ([...reqUrl.searchParams].length) {
    sendJson(res, 400, { error: 'Offline snapshot does not accept query parameters.' }, headers);
    return true;
  }
  try {
    sendJson(res, 200, await offlineSnapshot(req._auth.user.id), headers);
  } catch {
    sendJson(res, 500, { error: 'Could not download offline library.' }, headers);
  }
  return true;
}

module.exports = { handle };
