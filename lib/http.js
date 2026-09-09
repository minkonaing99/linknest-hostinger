const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const encodedFiles = new Map();
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.svg']);

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...SECURITY_HEADERS, ...extraHeaders });
  res.end(text);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end();
}

function selectEncoding(req, ext) {
  if (!COMPRESSIBLE_EXTENSIONS.has(ext)) return null;
  const accepted = String(req.headers?.['accept-encoding'] || '').split(',');
  const permits = name => accepted.some(value => {
    const [encoding, ...parameters] = value.trim().split(';');
    if (encoding !== name && encoding !== '*') return false;
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    return !quality || Number(quality.trim().slice(2)) > 0;
  });
  if (permits('br')) return 'br';
  if (permits('gzip')) return 'gzip';
  return null;
}

function encodeFile(data, encoding, key, callback) {
  if (!encoding) return callback(null, data);
  const cacheKey = `${key}:${encoding}`;
  if (encodedFiles.has(cacheKey)) return callback(null, encodedFiles.get(cacheKey));
  const done = (error, output) => {
    if (!error) encodedFiles.set(cacheKey, output);
    callback(error, output);
  };
  if (encoding === 'br') {
    zlib.brotliCompress(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, done);
  } else {
    zlib.gzip(data, { level: 6 }, done);
  }
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  };
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const etag = `W/"${stats.size}-${Math.trunc(stats.mtimeMs)}"`;
    const cacheControl = ext === '.html' ? 'private, no-cache' : 'public, max-age=0, must-revalidate';
    const variesByEncoding = COMPRESSIBLE_EXTENSIONS.has(ext);
    if (req.headers?.['if-none-match'] === etag) {
      const headers = { ETag: etag, 'Cache-Control': cacheControl, ...SECURITY_HEADERS };
      if (variesByEncoding) headers.Vary = 'Accept-Encoding';
      res.writeHead(304, headers);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      const encoding = selectEncoding(req, ext);
      encodeFile(data, encoding, `${filePath}:${etag}`, (encodeError, body) => {
        if (encodeError) {
          sendJson(res, 500, { error: 'Failed to serve file' });
          return;
        }
        const headers = {
          'Content-Type': types[ext] || 'application/octet-stream',
          'Content-Length': body.length,
          'Cache-Control': cacheControl,
          ETag: etag,
          ...SECURITY_HEADERS,
        };
        if (encoding) headers['Content-Encoding'] = encoding;
        if (variesByEncoding) headers.Vary = 'Accept-Encoding';
        res.writeHead(200, headers);
        res.end(body);
      });
    });
  });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { sendJson, sendText, sendRedirect, sendFile, parseBody, SECURITY_HEADERS };
