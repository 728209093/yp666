import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {PeerCertificate} from 'node:tls';
import {databaseTlsOptions} from '../scripts/mysql-tls.mjs';

test('database TLS checks the certificate name and keeps CA verification enabled', () => {
  const folder = mkdtempSync(join(tmpdir(), 'yp666-tls-'));
  try {
    writeFileSync(join(folder, 'ca.pem'), 'test-public-ca');
    const options = databaseTlsOptions({MYSQL_SSL_CA:'ca.pem'}, folder)!;
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.minVersion, 'TLSv1.2');
    const cert = {subjectaltname:'DNS:db.example.com', subject:{CN:'db.example.com'}} as PeerCertificate;
    assert.equal(options.checkServerIdentity!('db.example.com', cert), undefined);
    assert.equal(options.checkServerIdentity!('other.example.com', cert)?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    const tunneled = databaseTlsOptions({MYSQL_SSL_CA:'ca.pem',MYSQL_SSL_SERVERNAME:'db.example.com'}, folder)!;
    assert.equal(tunneled.checkServerIdentity!('localhost', cert), undefined);
  } finally {rmSync(folder, {recursive:true,force:true});}
});

test('database certificate pins fail closed for a different server certificate', () => {
  const folder = mkdtempSync(join(tmpdir(), 'yp666-tls-'));
  try {
    writeFileSync(join(folder, 'ca.pem'), 'test-public-ca');
    const raw = Buffer.from('known-server-certificate');
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    const options = databaseTlsOptions({MYSQL_SSL_CA:'ca.pem',MYSQL_SSL_SERVER_FINGERPRINT:fingerprint}, folder)!;
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity!('localhost', {raw} as PeerCertificate), undefined);
    assert.equal(options.checkServerIdentity!('localhost', {raw:Buffer.from('different-certificate')} as PeerCertificate)?.code, 'ERR_TLS_CERT_FINGERPRINT_MISMATCH');
    assert.throws(() => databaseTlsOptions({MYSQL_SSL_CA:'ca.pem',MYSQL_SSL_SERVER_FINGERPRINT:'not-a-pin'}, folder));
    assert.throws(() => databaseTlsOptions({MYSQL_SSL_SERVER_FINGERPRINT:fingerprint}, folder));
  } finally {rmSync(folder, {recursive:true,force:true});}
});
