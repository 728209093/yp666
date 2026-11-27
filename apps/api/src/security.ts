import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { allowedOrigins, cookieSecure } from './config.js';

export const visitorCookie = 'yp666_visitor';
export const adminCookie = 'yp666_admin';
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function cookieOptions(maxAge: number): CookieOptions { return {httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/api', maxAge}; }
export function parse<T extends ZodTypeAny>(schema:T,value:unknown):output<T> {
  try { return schema.parse(value); }
  catch (error) {
    if (error instanceof ZodError) throw new BadRequestException(error.issues[0]?.message || '请求参数不正确');
    throw error;
  }
}
export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}

export function originAllowed(origin: string | undefined, fetchSite?: string) {
  return origin ? allowedOrigins.has(origin) : fetchSite !== 'cross-site';
}

export class WindowLimiter {
  private entries = new Map<string,{count:number; reset:number}>();
  private nextSweep = 0;
  constructor(private readonly maximumEntries = 20_000) {}
  take(key: string, limit: number, milliseconds: number, now=Date.now()) {
    const current = this.entries.get(key);
    if (!current) {
      if (now >= this.nextSweep) {
        for (const [k,v] of this.entries) if (v.reset <= now) this.entries.delete(k);
        this.nextSweep = now + 30_000;
      }
      // Never evict live limits: changing IPs must not reset an existing limit.
      if (this.entries.size >= this.maximumEntries) return false;
    }
    if (!current || current.reset <= now) {
      this.entries.set(key,{count:1,reset:now+milliseconds});
      this.nextSweep=Math.min(this.nextSweep,now+milliseconds);
      return true;
    }
    current.count++;
    return current.count <= limit;
  }
}

export function requestRatePolicy(method: string, path: string) {
  // Express routes accept different casing and an optional trailing slash.
  const route = path.toLowerCase().replace(/\/+$/, '');
  if (route === '/admin/auth/login') return {category:'login', limit:12, milliseconds:60_000};
  if (route === '/admin/auth/password') return {category:'password', limit:5, milliseconds:15*60_000};
  if (route.startsWith('/verification/')) return {category:'verification', limit:40, milliseconds:60_000};
  if (route.endsWith('/uploads')) return {category:'upload', limit:20, milliseconds:60_000};
  if (method.toUpperCase()==='POST' && /\/messages$/.test(route)) return {category:'send', limit:40, milliseconds:60_000};
  return {category:'all', limit:600, milliseconds:60_000};
}

export function securityMiddleware() {
  const limits = new WindowLimiter();
  return (request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !originAllowed(request.get('origin'),request.get('sec-fetch-site'))) {
      response.status(403).json({message:'请求来源不被允许'}); return;
    }
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const policy=requestRatePolicy(request.method,request.path);
    if (!limits.take(`${ip}:${policy.category}`,policy.limit,policy.milliseconds)) {
      response.setHeader('Retry-After',String(Math.ceil(policy.milliseconds/1000))); response.status(429).json({message:'操作太频繁，请稍后再试'}); return;
    }
    next();
  };
}

export function challengeIsValid(input: {position: number; elapsedMs: number}, challenge: {targetX: number; createdAt: Date; expiresAt: Date; consumed: boolean; attempts: number}, now=Date.now()) {
  return Number.isFinite(input.position) && input.position>=0 && input.position<=276 && input.elapsedMs>=350
    && now-challenge.createdAt.getTime()>=350 && now<challenge.expiresAt.getTime()
    && !challenge.consumed && challenge.attempts<3 && Math.abs(input.position-challenge.targetX)<=5;
}
