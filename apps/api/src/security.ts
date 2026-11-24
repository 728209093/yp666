import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';
import { allowedOrigins, cookieSecure } from './config.js';

export const visitorCookie = 'yp666_visitor';
export const adminCookie = 'yp666_admin';
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function cookieOptions(maxAge: number): CookieOptions { return {httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/api', maxAge}; }
export function parse<T>(schema: ZodType<T>, value: unknown): T {
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
  take(key: string, limit: number, milliseconds: number, now=Date.now()) {
    if (this.entries.size > 10000) for (const [k,v] of this.entries) if (v.reset <= now) this.entries.delete(k);
    const current = this.entries.get(key);
    if (!current || current.reset <= now) { this.entries.set(key,{count:1,reset:now+milliseconds}); return true; }
    current.count++;
    return current.count <= limit;
  }
}

export function securityMiddleware() {
  const limits = new WindowLimiter();
  return (request: Request, response: Response, next: NextFunction) => {
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !originAllowed(request.get('origin'),request.get('sec-fetch-site'))) {
      response.status(403).json({message:'请求来源不被允许'}); return;
    }
    const route = request.path;
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const cap = route.includes('/auth/login') ? 12 : route.includes('/verification/') ? 40 : request.method==='POST' && route.includes('/messages') ? 40 : 600;
    const category=route.includes('/auth/login')?'login':route.includes('/verification/')?'verification':request.method==='POST'&&route.includes('/messages')?'send':'all';
    if (!limits.take(`${ip}:${category}`,cap,60000)) {
      response.setHeader('Retry-After','60'); response.status(429).json({message:'操作太频繁，请稍后再试'}); return;
    }
    response.setHeader('Cache-Control','no-store');
    next();
  };
}

export function challengeIsValid(input: {position: number; elapsedMs: number}, challenge: {targetX: number; createdAt: Date; expiresAt: Date; consumed: boolean; attempts: number}, now=Date.now()) {
  return Number.isFinite(input.position) && input.position>=0 && input.position<=276 && input.elapsedMs>=350
    && now-challenge.createdAt.getTime()>=350 && now<challenge.expiresAt.getTime()
    && !challenge.consumed && challenge.attempts<3 && Math.abs(input.position-challenge.targetX)<=5;
}
