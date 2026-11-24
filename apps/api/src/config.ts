import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({path: resolve(projectRoot, '.env.local'), quiet: true});
dotenv.config({path: resolve(projectRoot, '.env'), quiet: true});

export const isProduction = process.env.NODE_ENV === 'production';
export const captchaProvider = process.env.CAPTCHA_PROVIDER === 'turnstile' ? 'turnstile' : process.env.CAPTCHA_PROVIDER === 'slider' ? 'slider' : 'local';
export const uploadDirectory = resolve(projectRoot, 'data/uploads');
export const cookieSecure = isProduction || process.env.COOKIE_SECURE === 'true';
export const allowedOrigins = new Set((process.env.WEB_ORIGINS || process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174').split(',').map(value => value.trim()).filter(Boolean));

export function mysqlOptions() {
  const e = process.env;
  for (const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD']) {
    if (!e[key]) throw new Error(`缺少 ${key}，请检查项目根目录 .env.local`);
  }
  if (isProduction && !e.MYSQL_SSL_CA) throw new Error('生产环境必须配置 MYSQL_SSL_CA');
  return {
    host: e.MYSQL_HOST!, port: Number(e.MYSQL_PORT || 3306), database: e.MYSQL_DATABASE!,
    user: e.MYSQL_USER!, password: e.MYSQL_PASSWORD!, connectionLimit: 5, connectTimeout: 15000,
    ssl: e.MYSQL_SSL_CA ? {ca: readFileSync(resolve(projectRoot,e.MYSQL_SSL_CA)), rejectUnauthorized: true, checkServerIdentity: () => undefined} : undefined,
  };
}

export function validateStartup() {
  if (process.env.CAPTCHA_PROVIDER && !['local','slider','turnstile'].includes(process.env.CAPTCHA_PROVIDER)) {
    throw new Error('CAPTCHA_PROVIDER 必须为 local、slider 或 turnstile');
  }
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('请在根目录 .env.local 配置 ADMIN_USERNAME 和至少 12 位的 ADMIN_PASSWORD');
  }
  if (isProduction && captchaProvider === 'local') {
    throw new Error('生产环境不允许 local 开发模式。请明确配置 CAPTCHA_PROVIDER=slider，或配置 turnstile 和对应密钥。');
  }
  if (captchaProvider === 'turnstile' && (!process.env.TURNSTILE_SECRET_KEY || !process.env.TURNSTILE_SITE_KEY)) {
    throw new Error('Turnstile 验证需要 TURNSTILE_SECRET_KEY 和 TURNSTILE_SITE_KEY');
  }
  if (isProduction && !process.env.WEB_ORIGINS && !process.env.APP_ORIGINS) throw new Error('生产环境必须配置 APP_ORIGINS');
}
