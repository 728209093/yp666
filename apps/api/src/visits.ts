import { isIP } from 'node:net';
import type { Request } from 'express';
import { z } from 'zod';
import type { VisitDeviceType } from '@yp666/shared';
import { parse, shanghaiDate } from './security.js';

export interface VisitMetadata {
  ipAddress: string | null;
  deviceType: VisitDeviceType;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
  referrer: string | null;
}

function cleanHeader(value: string | undefined, maxLength: number) {
  return value?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) || null;
}

export function normalizeVisitIp(value: string | undefined) {
  const ip = value?.toLowerCase().startsWith('::ffff:') ? value.slice(7) : value;
  return ip && isIP(ip) ? ip.toLowerCase() : null;
}

export function classifyUserAgent(ua: string | null): Pick<VisitMetadata, 'deviceType' | 'browser' | 'os'> {
  if (!ua) return {deviceType: 'unknown', browser: null, os: null};
  const bot = /bot\b|crawler|spider|headless|curl\/|wget\//i.test(ua);
  const deviceType: VisitDeviceType = bot ? 'unknown' : /ipad|tablet|kindle|silk\/|android(?!.*mobile)/i.test(ua) ? 'tablet'
    : /mobile|iphone|ipod|windows phone/i.test(ua) ? 'mobile'
    : /windows|macintosh|x11|linux/i.test(ua) ? 'desktop' : 'unknown';
  const browserPatterns: [string, RegExp][] = [
    ['WeChat', /MicroMessenger\/([\d.]+)/i], ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/i],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/i], ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/i],
    ['Safari', /Version\/([\d.]+).*Safari\//i],
  ];
  let browser: string | null = null;
  for (const [name, pattern] of browserPatterns) {
    const match = ua.match(pattern);
    if (match) { browser = `${name} ${match[1]}`.slice(0, 80); break; }
  }
  let os: string | null = null;
  const androidVersion = ua.match(/Android\s+([\d.]+)/i)?.[1];
  const iosVersion = ua.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s+([\d_]+)/i)?.[1]?.replaceAll('_', '.');
  if (/windows phone/i.test(ua)) os = 'Windows Phone';
  else if (/android/i.test(ua)) os = `Android${androidVersion ? ` ${androidVersion}` : ''}`;
  else if (/iphone|ipad|ipod/i.test(ua)) os = `iOS${iosVersion ? ` ${iosVersion}` : ''}`;
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux|x11/i.test(ua)) os = 'Linux';
  return {deviceType, browser, os: os?.slice(0, 80) ?? null};
}

export function sanitizeReferrer(value: string | undefined) {
  if (!value || value.length > 8000) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // Queries, fragments and URL credentials can contain secrets and are never stored.
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch { return null; }
}

export function visitMetadata(request: Pick<Request, 'ip' | 'get'>): VisitMetadata {
  const userAgent = cleanHeader(request.get('user-agent'), 512);
  return {
    // Express resolves only the configured trusted proxy chain. Do not read X-Forwarded-For directly.
    ipAddress: normalizeVisitIp(request.ip),
    ...classifyUserAgent(userAgent), userAgent,
    referrer: sanitizeReferrer(request.get('referer')),
  };
}

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').refine(value => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}, '请选择有效日期');
const visitQuerySchema = z.object({
  dateFrom: calendarDate.optional(), dateTo: calendarDate.optional(),
  deviceType: z.enum(['mobile', 'tablet', 'desktop', 'unknown']).optional(),
  keyword: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).transform(query => {
  const today = shanghaiDate();
  return {...query, dateFrom: query.dateFrom ?? query.dateTo ?? today, dateTo: query.dateTo ?? query.dateFrom ?? today};
}).superRefine((query, context) => {
  const days = (Date.parse(`${query.dateTo}T00:00:00Z`) - Date.parse(`${query.dateFrom}T00:00:00Z`)) / 86_400_000;
  if (days < 0) context.addIssue({code: 'custom', path: ['dateTo'], message: '结束日期不能早于开始日期'});
  if (days >= 90) context.addIssue({code: 'custom', path: ['dateTo'], message: '一次最多查询 90 天的访问记录'});
});
export const parseVisitQuery = (value: unknown) => parse(visitQuerySchema, value);
export type VisitQuery = ReturnType<typeof parseVisitQuery>;
