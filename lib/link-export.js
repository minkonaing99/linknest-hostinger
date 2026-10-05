'use strict';

const { readLinks, readAllLinksForExport } = require('./links');
const { parseLinkListQuery, validationError } = require('./utils');

const FILTERS = new Set(['q', 'search', 'tag', 'status', 'sort', 'order', 'includeDeleted',
  'updatedAfter', 'remindBefore', 'staleBefore', 'ageBefore', 'neverOpened', 'youtube']);
const VALUES = {
  status: ['saved', 'unread', 'useful', 'archived', 'deleted'],
  sort: ['updatedAt', 'createdAt', 'date', 'title'],
  order: ['asc', 'desc'], youtube: ['only', 'exclude'],
  includeDeleted: ['true', 'false'], neverOpened: ['true', 'false'],
};

function validateParameters(params, allowed) {
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      throw validationError(`Invalid or repeated export parameter: ${key}`);
    }
  }
}

function validateFilters(params) {
  validateParameters(params, new Set(['scope', ...FILTERS]));
  if (params.has('q') && params.has('search')) throw validationError('Use q or search, not both');
  for (const [key, values] of Object.entries(VALUES)) {
    if (params.has(key) && !values.includes(params.get(key))) {
      throw validationError(`Invalid ${key} filter`);
    }
  }
  for (const key of ['updatedAfter', 'remindBefore', 'staleBefore', 'ageBefore']) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) {
      throw validationError(`Invalid ${key} filter`);
    }
  }
}

async function readSelectedLinks(params) {
  validateParameters(params, new Set(['scope', 'ids']));
  const raw = params.get('ids') || '';
  let ids;
  try { ids = /^[\[{]/.test(raw) ? JSON.parse(raw) : raw.split(','); }
  catch { throw validationError('Invalid selected link IDs'); }
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !id || id.length > 36 || id.trim() !== id || /[\x00-\x1f\x7f]/.test(id))) {
    throw validationError('Select 1-200 distinct, valid link IDs');
  }
  const { links } = await readLinks({
    whereClause: 'id IN (?)', params: [ids], orderClause: 'id ASC', limit: ids.length, skip: 0,
  });
  const byId = new Map(links.map(link => [link.id, link]));
  if (links.length !== ids.length || ids.some(id => !byId.has(id))) {
    throw Object.assign(new Error('Some selected links no longer exist. Refresh and select again.'), { statusCode: 404 });
  }
  return ids.map(id => byId.get(id));
}

async function readMarkdownExport(params) {
  if (!params.has('scope')) {
    if (params.has('ids')) throw validationError('Selected IDs require scope=selected');
    return readAllLinksForExport();
  }
  const scope = params.get('scope');
  if (scope === 'selected') return readSelectedLinks(params);
  if (scope !== 'filtered') throw validationError('scope must be selected or filtered');
  validateFilters(params);
  const result = await readLinks({ ...parseLinkListQuery(params), limit: 5001, skip: 0, page: 1 });
  if (result.total > 5000 || result.links.length > 5000) {
    throw validationError('Export is limited to 5,000 matching links. Narrow your filters and try again.');
  }
  return result.links;
}

module.exports = { readMarkdownExport };
