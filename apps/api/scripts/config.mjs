import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { databaseTlsOptions } from './mysql-tls.mjs';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: resolve(projectRoot, '.env.local'), quiet: true });
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });

export function databaseOptions() {
  const e = process.env;
  for (const key of ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
    if (!e[key]) throw new Error(`缺少数据库配置 ${key}，请检查项目根目录 .env.local`);
  }
  return {
    host: e.MYSQL_HOST, port: Number(e.MYSQL_PORT || 3306), database: e.MYSQL_DATABASE,
    user: e.MYSQL_USER, password: e.MYSQL_PASSWORD, connectTimeout: 15000,
    ssl: databaseTlsOptions(e, projectRoot),
  };
}

export function databaseUrl() {
  const e = process.env;
  return `mysql://${encodeURIComponent(e.MYSQL_USER || 'generate')}:${encodeURIComponent(e.MYSQL_PASSWORD || 'generate')}@${e.MYSQL_HOST || '127.0.0.1'}:${e.MYSQL_PORT || 3306}/${e.MYSQL_DATABASE || 'yp666'}`;
}
