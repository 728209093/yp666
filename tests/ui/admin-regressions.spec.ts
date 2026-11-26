import {test, expect, type Page, type Route} from '@playwright/test';
import {defaultDocument, type ChatMessage, type ConversationSummary} from '../../packages/shared/src/index';

const createdAt = '2026-01-01T00:00:00.000Z';
const summary: ConversationSummary = {
  id: 'conversation-one', visitorLabel: '访客一', lastMessage: '你好',
  unreadCount: 0, createdAt, updatedAt: createdAt,
};
const firstMessage: ChatMessage = {id: 'visitor-one', role: 'visitor', type: 'text', content: '你好', createdAt};
const sentMessage: ChatMessage = {id: 'reply-one', role: 'admin', type: 'richtext', content: '<p>刚发送的回复</p>', createdAt};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

async function mockAdmin(page: Page, handle: (route: Route, path: string) => Promise<boolean>) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (await handle(route, path)) return;
    if (path === '/api/admin/auth/me') {
      await route.fulfill({json: {username: 'admin'}});
    } else if (path === '/api/admin/content') {
      await route.fulfill({json: {draft: defaultDocument, published: defaultDocument, publishedAt: createdAt}});
    } else {
      // Never forward an unexpected API request to a database-backed server.
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
}

test('新密码按 UTF-8 字节限制，保留现有长密码的输入', async ({page}) => {
  const submissions: {currentPassword: string; newPassword: string}[] = [];
  await mockAdmin(page, async (route, path) => {
    if (path !== '/api/admin/auth/password') return false;
    submissions.push(route.request().postDataJSON());
    await route.fulfill({json: {ok: true}});
    return true;
  });
  await page.goto('/#security');
  const current = 'existing-' + '密'.repeat(25);
  await page.getByLabel('当前密码', {exact: true}).fill(current);
  for (const password of ['密'.repeat(25), '🔐'.repeat(19)]) {
    await page.getByLabel('新密码', {exact: true}).fill(password);
    await page.getByLabel('再次输入新密码', {exact: true}).fill(password);
    await page.getByRole('button', {name: '更新密码'}).click();
    await expect(page.getByRole('alert')).toContainText('72');
    expect(submissions).toHaveLength(0);
  }
  const valid = '密'.repeat(24); // Exactly 72 UTF-8 bytes.
  await page.getByLabel('新密码', {exact: true}).fill(valid);
  await page.getByLabel('再次输入新密码', {exact: true}).fill(valid);
  await page.getByRole('button', {name: '更新密码'}).click();
  await expect(page.getByRole('button', {name: '进入工作台'})).toBeVisible();
  expect(submissions).toEqual([{currentPassword: current, newPassword: valid}]);
});

test('发送成功后迟到的会话轮询不能隐藏新回复', async ({page}) => {
  const pending = deferred<Route>();
  let detailRequests = 0;
  let sent = false;
  await mockAdmin(page, async (route, path) => {
    if (path === '/api/admin/conversations') {
      await route.fulfill({json: [summary]});
    } else if (path === '/api/admin/conversations/conversation-one') {
      detailRequests++;
      if (detailRequests === 2) pending.resolve(route);
      else await route.fulfill({json: {conversation: summary, messages: sent ? [firstMessage, sentMessage] : [firstMessage]}});
    } else if (path === '/api/admin/conversations/conversation-one/messages') {
      expect(route.request().method()).toBe('POST');
      sent = true;
      await route.fulfill({json: [firstMessage, sentMessage]});
    } else return false;
    return true;
  });
  await page.clock.install();
  await page.goto('/#messages');
  await page.locator('.conversation-row').click();
  await expect(page.locator('.admin-messages')).toContainText('你好');
  await page.clock.fastForward(4000);
  const stale = await pending.promise;
  await page.getByRole('textbox', {name: '回复内容'}).fill('刚发送的回复');
  await page.getByRole('button', {name: '发送回复'}).click();
  await expect(page.locator('.admin-messages')).toContainText('刚发送的回复');
  const response = page.waitForResponse(r => r.url().endsWith('/api/admin/conversations/conversation-one'));
  await stale.fulfill({json: {conversation: summary, messages: [firstMessage]}});
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Read once after the stale response is rendered: retrying until a later poll
  // restores the reply would conceal the regression.
  expect(await page.locator('.admin-messages').innerText()).toContain('刚发送的回复');
});

test('重新打开同一会话后丢弃旧的轮询结果', async ({page}) => {
  const pending = deferred<Route>();
  let detailRequests = 0;
  await mockAdmin(page, async (route, path) => {
    if (path === '/api/admin/conversations') {
      await route.fulfill({json: [summary]});
    } else if (path === '/api/admin/conversations/conversation-one') {
      detailRequests++;
      if (detailRequests === 2) pending.resolve(route);
      else await route.fulfill({json: {conversation: summary, messages: detailRequests > 2 ? [firstMessage, sentMessage] : [firstMessage]}});
    } else return false;
    return true;
  });
  await page.clock.install();
  await page.goto('/#messages');
  await page.locator('.conversation-row').click();
  await expect(page.locator('.admin-messages')).toContainText('你好');
  await page.clock.fastForward(4000);
  const stale = await pending.promise;
  await page.locator('.conversation-row').click();
  await expect(page.locator('.admin-messages')).toContainText('刚发送的回复');
  const response = page.waitForResponse(r => r.url().endsWith('/api/admin/conversations/conversation-one'));
  await stale.fulfill({json: {conversation: summary, messages: [firstMessage]}});
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.locator('.admin-messages').innerText()).toContain('刚发送的回复');
});
