import {test, expect} from '@playwright/test';
import {defaultDocument} from '../../packages/shared/src/index';

for (const viewport of [{width: 390, height: 844}, {width: 1440, height: 960}]) {
  test(`上下滚动只移动聊天记录，顶部公告和输入框保持固定（${viewport.width}px）`, async ({page}) => {
    await page.setViewportSize(viewport);
    const document = structuredClone(defaultDocument);
    document.settings.verificationEnabled = false;
    document.settings.announcement = '固定在顶部的公告';
    document.blocks = [];
    document.faqs = [];
    const messages = Array.from({length: 40}, (_,index) => ({
      id: `message-${index}`, role: 'visitor', type: 'text',
      content: `滚动检查消息 ${index + 1}`, createdAt: '2026-11-26T04:00:00Z',
    }));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/public/bootstrap') await route.fulfill({json: {site: document.settings, verificationRequired: false, verified: true, captchaProvider: 'local'}});
      else if (path === '/api/public/content') await route.fulfill({json: document});
      else if (path === '/api/visitor/messages' && route.request().method() === 'GET') await route.fulfill({json: messages});
      else {
        await route.fulfill({status: 500, json: {message: `Unexpected request: ${path}`}});
        throw new Error(`Unexpected request: ${path}`);
      }
    });
    await page.goto('http://127.0.0.1:5273');
    await expect(page.locator('.loading-screen')).toBeHidden();
    const chat = page.locator('.chat-scroll');
    const header = page.locator('.room-topline');
    const footer = page.locator('.composer-area');
    const originalHeader = await header.boundingBox();
    const originalFooter = await footer.boundingBox();
    expect(originalHeader).not.toBeNull();
    expect(originalFooter).not.toBeNull();
    const assertFixed = async () => {
      expect((await header.boundingBox())!.y).toBeCloseTo(originalHeader!.y, 1);
      expect((await footer.boundingBox())!.y).toBeCloseTo(originalFooter!.y, 1);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    };
    await chat.evaluate(node => {node.scrollTop = 0;});
    await expect.poll(() => chat.evaluate(node => node.scrollTop)).toBe(0);
    await chat.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => chat.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    await assertFixed();
    await chat.evaluate(node => {node.scrollTop = node.scrollHeight;});
    await expect.poll(() => chat.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
    await page.mouse.wheel(0, 1000);
    await assertFixed();
    await chat.evaluate(node => {node.scrollTop = 0;});
    await expect.poll(() => chat.evaluate(node => node.scrollTop)).toBe(0);
    await page.mouse.wheel(0, -1000);
    await header.hover();
    await page.mouse.wheel(0, 800);
    await assertFixed();
    expect(await page.evaluate(() => {
      const page = document.scrollingElement!;
      return page.scrollHeight <= page.clientHeight;
    })).toBe(true);
  });
}
