'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Override dns.promises.lookup before utils.js loads.
// lib/utils.js captures `require('dns').promises` by reference, so mutating
// the lookup property here affects utils.js's dns reference too.
let resolvedAddress = '93.184.216.34'; // default: public
const dns = require('dns');
dns.promises.lookup = async () => ({ address: resolvedAddress });

const { assertPublicUrl, isPrivateIp } = require('../lib/utils');

// ---

describe('isPrivateIp', () => {
  it('flags 127.x loopback', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('127.255.255.255'), true);
  });

  it('flags 10.x class A private', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('10.255.255.255'), true);
  });

  it('flags 192.168.x class C private', () => {
    assert.equal(isPrivateIp('192.168.0.1'), true);
    assert.equal(isPrivateIp('192.168.255.255'), true);
  });

  it('flags 172.16-31.x class B private', () => {
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.255'), true);
  });

  it('does not flag 172.15.x or 172.32.x as private', () => {
    assert.equal(isPrivateIp('172.15.0.1'), false);
    assert.equal(isPrivateIp('172.32.0.1'), false);
  });

  it('flags 169.254.x link-local (AWS metadata endpoint)', () => {
    assert.equal(isPrivateIp('169.254.169.254'), true);
    assert.equal(isPrivateIp('169.254.0.1'), true);
  });

  it('flags 100.64-127.x CGNAT range', () => {
    assert.equal(isPrivateIp('100.64.0.1'), true);
    assert.equal(isPrivateIp('100.127.255.255'), true);
    assert.equal(isPrivateIp('100.63.255.255'), false);
    assert.equal(isPrivateIp('100.128.0.1'), false);
  });

  it('flags IPv6 loopback ::1', () => {
    assert.equal(isPrivateIp('::1'), true);
    assert.equal(isPrivateIp('0:0:0:0:0:0:0:1'), true);
  });

  it('flags IPv6 unique-local fc00::/7', () => {
    assert.equal(isPrivateIp('fc00::1'), true);
    assert.equal(isPrivateIp('fd12:3456::1'), true);
  });

  it('flags IPv6 link-local fe80::/10', () => {
    assert.equal(isPrivateIp('fe80::1'), true);
  });

  it('allows public IPv4 addresses', () => {
    assert.equal(isPrivateIp('93.184.216.34'), false);
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
  });
});

describe('assertPublicUrl', () => {
  it('resolves without error for public URL', async () => {
    resolvedAddress = '93.184.216.34';
    await assert.doesNotReject(() => assertPublicUrl('https://example.com'));
  });

  it('rejects URL resolving to loopback 127.0.0.1', async () => {
    resolvedAddress = '127.0.0.1';
    await assert.rejects(
      () => assertPublicUrl('https://localhost'),
      { message: 'URL resolves to a private or reserved address' },
    );
  });

  it('rejects URL resolving to 10.x private range', async () => {
    resolvedAddress = '10.0.0.1';
    await assert.rejects(
      () => assertPublicUrl('https://internal.example.com'),
      { message: 'URL resolves to a private or reserved address' },
    );
  });

  it('rejects URL resolving to 192.168.x', async () => {
    resolvedAddress = '192.168.1.100';
    await assert.rejects(
      () => assertPublicUrl('https://router.local'),
      { message: 'URL resolves to a private or reserved address' },
    );
  });

  it('rejects URL resolving to 169.254.169.254 (AWS metadata service)', async () => {
    resolvedAddress = '169.254.169.254';
    await assert.rejects(
      () => assertPublicUrl('https://metadata.example.com'),
      { message: 'URL resolves to a private or reserved address' },
    );
  });

  it('rejects non-http/https protocol', async () => {
    resolvedAddress = '93.184.216.34';
    await assert.rejects(
      () => assertPublicUrl('ftp://example.com/file'),
      { message: 'Only HTTP and HTTPS URLs are allowed' },
    );
  });

  it('rejects file:// protocol', async () => {
    resolvedAddress = '93.184.216.34';
    await assert.rejects(
      () => assertPublicUrl('file:///etc/passwd'),
      { message: 'Only HTTP and HTTPS URLs are allowed' },
    );
  });
});
