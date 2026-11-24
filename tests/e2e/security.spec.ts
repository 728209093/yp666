import { test, expect } from '@playwright/test';
import { apiUrl, cleanupVisitor, targetFor, loginAdmin, database } from './helpers';
import { createHash } from 'node:crypto';

test('内容接口鉴权、拼图隔离与防重放、会话到期及管理权限', async ({ playwright }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const visitor = await playwright.request.newContext();
  const stranger = await playwright.request.newContext();
  const admin = await playwright.request.newContext();
  const cookieContext = { cookies: async () => (await visitor.storageState()).cookies };
  try {
    expect((await visitor.get(`${apiUrl}/public/content`)).status()).toBe(403);
    expect((await visitor.get(`${apiUrl}/admin/content`)).status()).toBe(401);
    await visitor.get(`${apiUrl}/public/bootstrap`);
    const challenge = await (await visitor.get(`${apiUrl}/verification/challenge`)).json();
    expect(challenge.targetX).toBeUndefined();
    const x = await targetFor(challenge.id);
    await stranger.get(`${apiUrl}/public/bootstrap`);
    expect((await stranger.post(`${apiUrl}/verification/verify`, { data: {challengeId: challenge.id, position: x, elapsedMs: 1000} })).ok()).toBeFalsy();
    await new Promise(resolve => setTimeout(resolve, 400));
    const payload = {challengeId: challenge.id, position: x, elapsedMs: 1000};
    const verified = await visitor.post(`${apiUrl}/verification/verify`, {data: payload});
    expect(verified.ok(), await verified.text()).toBeTruthy();
    expect((await visitor.post(`${apiUrl}/verification/verify`, {data: payload})).ok()).toBeFalsy();
    expect((await visitor.get(`${apiUrl}/public/content`)).ok()).toBeTruthy();
    expect((await visitor.post(`${apiUrl}/visitor/messages`, {headers: {Origin: 'https://untrusted.example'}, data: {content: '拒绝跨站请求'} })).status()).toBe(403);
    const db = await database();
    try { await db.execute('UPDATE Visitor SET verifiedUntil = ? WHERE id = (SELECT visitorId FROM Challenge WHERE id = ?)', [new Date(Date.now() - 60000), createHash('sha256').update(challenge.id).digest('hex').slice(0,32)]); }
    finally { await db.end(); }
    expect((await visitor.get(`${apiUrl}/public/content`)).status()).toBe(403);
    await loginAdmin(admin);
    const original = await (await admin.get(`${apiUrl}/admin/content`)).json();
    const unsafe = structuredClone(original.draft);
    unsafe.settings.avatarUrl = 'javascript:alert(1)';
    expect((await admin.put(`${apiUrl}/admin/content`, {data: {document: unsafe}})).status()).toBe(400);
    const logout = await admin.post(`${apiUrl}/admin/auth/logout`);
    expect(logout.ok()).toBeTruthy();
    expect((await admin.get(`${apiUrl}/admin/content`)).status()).toBe(401);
  } finally {
    await cleanupVisitor(cookieContext);
    const state = await stranger.storageState();
    await cleanupVisitor({cookies: async () => state.cookies});
    await visitor.dispose(); await stranger.dispose(); await admin.dispose();
  }
});
