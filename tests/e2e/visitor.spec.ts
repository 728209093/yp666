import { test, expect } from '@playwright/test';
import { cleanupVisitor, solve } from './helpers';

test('验证后可浏览、咨询并在刷新后保留会话', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const challengeResponse = page.waitForResponse(r => r.url().endsWith('/api/verification/challenge') && r.ok());
    await page.goto('/');
    const challenge = await (await challengeResponse).json();
    await expect(page.getByRole('slider')).toBeVisible();
    const protectedResponse = await page.request.get('/api/public/content');
    expect(protectedResponse.status()).toBe(403);
    expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/verification-${test.info().project.name}.png`, fullPage: true });
    await solve(page, challenge.id);
    await expect(page.getByRole('region', { name: '在线会客厅' })).toBeVisible();
    await page.getByRole('button', { name: '这里可以了解哪些服务？' }).first().click();
    await expect(page.getByText('你可以在这里查看服务介绍、最新资讯和使用帮助。如果有具体需求，直接留言告诉我们就好。', { exact: true })).toBeVisible();
    const message = `本地验收留言 ${test.info().project.name} ${Date.now()}`;
    await page.getByRole('textbox', { name: '咨询消息' }).fill(message);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: '咨询消息' })).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/conversation-${test.info().project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await cleanupVisitor(context); }
});
