import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

export function databaseTlsOptions(env, projectRoot) {
  const fingerprint = (env.MYSQL_SSL_SERVER_FINGERPRINT || '').replaceAll(':', '').toLowerCase();
  if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('MYSQL_SSL_SERVER_FINGERPRINT 必须是 SHA-256 证书指纹');
  if (!env.MYSQL_SSL_CA) {
    if (fingerprint || env.MYSQL_SSL_SERVERNAME) throw new Error('配置数据库证书身份校验时必须同时配置 MYSQL_SSL_CA');
    return undefined;
  }
  return {
    ca: readFileSync(resolve(projectRoot, env.MYSQL_SSL_CA)),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    checkServerIdentity(hostname, certificate) {
      if (!fingerprint) return checkServerIdentity(env.MYSQL_SSL_SERVERNAME || hostname, certificate);
      // TLS still verifies the CA chain first. A pin also binds tunnel connections
      // to the exact server certificate when a legacy certificate has no DNS SAN.
      const actual = createHash('sha256').update(certificate.raw).digest();
      const expected = Buffer.from(fingerprint, 'hex');
      if (!timingSafeEqual(actual, expected)) return Object.assign(new Error('数据库服务器证书指纹不匹配'), {code: 'ERR_TLS_CERT_FINGERPRINT_MISMATCH'});
    },
  };
}
