'use strict';

const { sendJson, parseBody } = require('../http');
const { ensurePlainObject, parseLinkListQuery, parseBooleanFlag, jaroWinkler } = require('../utils');
const {
  readLink, readLinks, createLink, updateLink,
  deleteLink, restoreLink, bulkUpdateStatus, openLink, findDuplicateCandidates,
} = require('../links');

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function isBase(pathname) {
  return is(pathname, '/api/links', '/api/v1/links');
}

function itemId(pathname) {
  for (const prefix of ['/api/links/', '/api/v1/links/']) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    return decodeURIComponent(rest);
  }
  return null;
}

function openedId(pathname) {
  for (const prefix of ['/api/links/', '/api/v1/links/']) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    const parts = rest.split('/');
    if (parts.length === 2 && parts[1] === 'opened') return decodeURIComponent(parts[0]);
  }
  return null;
}

function restoreId(pathname) {
  for (const prefix of ['/api/links/restore/', '/api/v1/links/restore/']) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    return decodeURIComponent(rest);
  }
  return null;
}

async function handleList(req, res, reqUrl) {
  try {
    const opts = parseLinkListQuery(reqUrl.searchParams);
    const result = await readLinks(opts);
    sendJson(res, 200, {
      ...result,
      query: {
        q:              opts.query,
        status:         opts.status  || null,
        tag:            opts.tag     || null,
        sort:           opts.sortField,
        order:          opts.sortOrder,
        includeDeleted: opts.includeDeleted,
        updatedAfter:   opts.updatedAfter,
      },
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handleGet(req, res, id) {
  try {
    const entry = await readLink(id);
    sendJson(res, 200, { entry });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handleCreate(req, res) {
  try {
    const { entry, duplicateCandidates } = await createLink(ensurePlainObject(await parseBody(req)));
    const body = { ok: true, entry };
    if (duplicateCandidates.length > 0) body.duplicateCandidates = duplicateCandidates;
    sendJson(res, 201, body);
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleDuplicates(req, res, reqUrl) {
  try {
    const url = String(reqUrl.searchParams.get('url') || '').trim();
    const title = String(reqUrl.searchParams.get('title') || '').trim();
    if (!url) {
      sendJson(res, 400, { error: 'url query param is required' });
      return;
    }
    const candidates = await findDuplicateCandidates(url, title || url);
    sendJson(res, 200, { candidates });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handleScanDuplicates(req, res) {
  try {
    const { links } = await readLinks({ limit: 2000, skip: 0, page: 1, whereClause: 'deleted_at IS NULL', params: [], orderClause: 'host ASC, updated_at DESC' });
    const byHost = new Map();
    for (const link of links) {
      const h = link.host || '';
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h).push(link);
    }
    const pairs = [];
    for (const group of byHost.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const sim = jaroWinkler(group[i].title || group[i].url, group[j].title || group[j].url);
          if (sim >= 0.75) {
            pairs.push({
              a: { id: group[i].id, url: group[i].url, title: group[i].title },
              b: { id: group[j].id, url: group[j].url, title: group[j].title },
              similarity: Math.round(sim * 100) / 100,
            });
          }
        }
      }
    }
    pairs.sort((a, b) => b.similarity - a.similarity);
    sendJson(res, 200, { pairs, total: pairs.length });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handleUpdate(req, res, id) {
  try {
    const entry = await updateLink(id, ensurePlainObject(await parseBody(req)));
    sendJson(res, 200, { ok: true, entry });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleDelete(req, res, reqUrl, id) {
  try {
    const result = await deleteLink(id, {
      hardDelete: parseBooleanFlag(reqUrl.searchParams.get('hardDelete'), false),
    });
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleRestore(req, res, id) {
  try {
    const entry = await restoreLink(id);
    sendJson(res, 200, { ok: true, entry });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleOpened(req, res, id) {
  try {
    const entry = await openLink(id);
    sendJson(res, 200, { ok: true, entry });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleBulk(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const status = String(body.status || '').trim();
    if (!status) {
      sendJson(res, 400, { error: 'status is required' });
      return;
    }
    const result = await bulkUpdateStatus(ids, status);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handle(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const m = req.method;
  const id  = itemId(p);
  const rid = restoreId(p);
  const oid = openedId(p);

  if (m === 'GET'   && isBase(p))                                                                          return handleList(req, res, reqUrl), true;
  if (m === 'POST'  && isBase(p))                                                                          return handleCreate(req, res), true;
  if (m === 'GET'   && is(p, '/api/links/duplicates',      '/api/v1/links/duplicates'))                   return handleDuplicates(req, res, reqUrl), true;
  if (m === 'GET'   && is(p, '/api/links/scan-duplicates', '/api/v1/links/scan-duplicates'))              return handleScanDuplicates(req, res), true;
  if (m === 'POST'  && oid)                                                                                return handleOpened(req, res, oid), true;
  if (m === 'POST'  && rid)                                                                                return handleRestore(req, res, rid), true;
  if (m === 'PATCH' && is(p, '/api/links/bulk', '/api/v1/links/bulk'))                                    return handleBulk(req, res), true;
  if (m === 'GET'   && id)                                                                                 return handleGet(req, res, id), true;
  if (m === 'PUT'   && id)                                                                                 return handleUpdate(req, res, id), true;
  if (m === 'DELETE'&& id)                                                                                 return handleDelete(req, res, reqUrl, id), true;

  return false;
}

module.exports = { handle };
