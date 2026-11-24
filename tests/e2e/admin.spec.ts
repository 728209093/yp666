import { test, expect } from '@playwright/test';
import { apiUrl, cleanupVisitor, database, loginAdmin, solve } from './helpers';
import type mysql from 'mysql2/promise';

test('后台登录、草稿发布、图片上传及人工回复', async ({ page, context, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const admin = await playwright.request.newContext();
  await loginAdmin(admin);
  const originalResponse = await admin.get(`${apiUrl}/admin/content`);
  const original = await originalResponse.json();
  const adminPage = await context.newPage();
  let uploadUrl = '';
  try {
    await adminPage.goto('http://127.0.0.1:5174');
    await adminPage.getByLabel('管理员账号').fill(process.env.ADMIN_USERNAME!);
    await adminPage.getByLabel('登录密码', { exact: true }).fill(process.env.ADMIN_PASSWORD!);
    await adminPage.getByRole('button', { name: '进入工作台' }).click();
    await expect(adminPage.locator('.sidebar')).toBeVisible();
    await expect(adminPage.locator('.dashboard-page .el-loading-mask')).toHaveCount(0, {timeout:20000});
    await adminPage.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true });
    await adminPage.getByRole('button', { name: '页面设置', exact: true }).click();
    const brand = adminPage.getByLabel('品牌名称', { exact: true });
    await expect(brand).toHaveValue(original.draft.settings.brandName);
    const draft = structuredClone(original.draft);
    draft.settings.introTitle = `端到端验收 ${Date.now()}`;
    expect((await admin.put(`${apiUrl}/admin/content`, {data: {document: draft}})).ok()).toBeTruthy();
    const afterSave = await (await admin.get(`${apiUrl}/admin/content`)).json();
    expect(afterSave.published.settings.introTitle).toBe(original.published.settings.introTitle);
    expect(afterSave.draft.settings.introTitle).toBe(draft.settings.introTitle);
    expect((await admin.post(`${apiUrl}/admin/content/publish`)).ok()).toBeTruthy();
    const challengeResponse = page.waitForResponse(r => r.url().endsWith('/api/verification/challenge') && r.ok());
    await page.goto('/');
    const challenge = await (await challengeResponse).json();
    await solve(page, challenge.id);
    await expect(page.getByText(draft.settings.introTitle, {exact:true})).toBeVisible();
    const note = `人工回复验收 ${Date.now()}`;
    await page.getByRole('textbox', {name:'咨询消息'}).fill(note);
    await page.getByRole('button', {name:'发送消息'}).click();
    await expect(page.getByText(note, {exact:true})).toBeVisible();
    const db = await database();
    let conversationId: string;
    try {
      const [rows] = await db.execute<mysql.RowDataPacket[]>('SELECT conversationId FROM Message WHERE content = ?', [note]);
      conversationId = rows[0]!.conversationId;
    } finally { await db.end(); }
    const reply = `你好，我们已经收到你的咨询 ${Date.now()}`;
    expect((await admin.post(`${apiUrl}/admin/conversations/${conversationId}/messages`, {data:{content:reply}})).ok()).toBeTruthy();
    await expect(page.getByText(reply, {exact:true})).toBeVisible({timeout:20000});
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRzEAAAAASUVORK5CYII=', 'base64');
    const upload = await admin.post(`${apiUrl}/admin/uploads`, {multipart:{file:{name:'test.png',mimeType:'image/png',buffer:png}}});
    expect(upload.ok(), await upload.text()).toBeTruthy();
    uploadUrl = (await upload.json()).url;
    expect(uploadUrl).toMatch(/^\/uploads\/[\w-]+\.webp$/);
    expect((await admin.get(`http://127.0.0.1:3001${uploadUrl}`)).ok()).toBeTruthy();
    const invalid = await admin.post(`${apiUrl}/admin/uploads`, {multipart:{file:{name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg onload="alert(1)"></svg>')}}});
    expect(invalid.status()).toBe(400);
    await adminPage.getByRole('button',{name:'访客咨询',exact:true}).click();
    await expect(adminPage.locator('.conversation-workspace')).toBeVisible();
    await expect(adminPage.locator('.conversation-sidebar .el-loading-mask')).toHaveCount(0, {timeout:20000});
    await adminPage.screenshot({path:'test-results/admin-conversations.png',fullPage:true});
  } finally {
    // Restore both publication and any previously uncommitted draft.
    await admin.put(`${apiUrl}/admin/content`, {data:{document:original.published}});
    await admin.post(`${apiUrl}/admin/content/publish`);
    await admin.put(`${apiUrl}/admin/content`, {data:{document:original.draft}});
    await cleanupVisitor(context);
    if (uploadUrl) {
      const {unlink} = await import('node:fs/promises');
      const {basename,resolve} = await import('node:path');
      await unlink(resolve('data/uploads',basename(uploadUrl))).catch(()=>{});
    }
    await admin.post(`${apiUrl}/admin/auth/logout`);
    await admin.dispose();
  }
});
