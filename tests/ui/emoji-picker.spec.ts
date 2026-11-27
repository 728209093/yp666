import {test, expect, type Page} from '@playwright/test';
import {defaultDocument} from '../../packages/shared/src/index';

async function openRoom(page: Page) {
  const document = structuredClone(defaultDocument);
  document.settings.verificationEnabled = false;
  document.settings.welcomeMessage = '';
  document.blocks = [];
  document.faqs = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/public/bootstrap') await route.fulfill({json: {site: document.settings, verified: true, verificationRequired: false, captchaProvider: 'local'}});
    else if (path === '/api/public/content') await route.fulfill({json: document});
    else if (path === '/api/visitor/messages' && route.request().method() === 'GET') await route.fulfill({json: []});
    else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.goto('http://127.0.0.1:5273');
  await expect(page.locator('.loading-screen')).toBeHidden();
  await expect(page.getByRole('textbox', {name: '咨询消息'})).toBeVisible();
}

async function expectContainedEmoji(page: Page) {
  const geometry = await page.locator('.emoji-panel').evaluate(panel => {
    const panelBox = panel.getBoundingClientRect();
    const grid = panel.querySelector<HTMLElement>('.emoji-grid')!;
    const boxes = [...grid.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      return {left: box.left, right: box.right, textLeft: text.left, textRight: text.right};
    });
    return {left: panelBox.left, right: panelBox.right, top: panelBox.top, bottom: panelBox.bottom,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      overflow: grid.scrollWidth - grid.clientWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth, boxes};
  });
  expect(geometry.boxes).toHaveLength(36);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  for (const box of geometry.boxes) {
    expect(box.left).toBeGreaterThanOrEqual(geometry.left);
    expect(box.right).toBeLessThanOrEqual(geometry.right);
    expect(box.textLeft).toBeGreaterThanOrEqual(box.left - 1);
    expect(box.textRight).toBeLessThanOrEqual(box.right + 1);
  }
}

for (const width of [320, 360, 390, 1440]) {
  test(`表情完整保持在面板内且末尾表情可插入（${width}px）`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    await openRoom(page);
    await page.getByRole('button', {name: '选择表情', exact: true}).click();
    await page.screenshot({path: testInfo.outputPath(`emoji-${width}.png`), fullPage: true});
    await expectContainedEmoji(page);
    await page.getByRole('button', {name: '插入表情 🍀', exact: true}).click();
    await expect(page.getByRole('textbox', {name: '咨询消息'})).toHaveValue('🍀');
    await page.getByRole('button', {name: '关闭表情', exact: true}).click();
    await expect(page.locator('.emoji-panel')).toHaveCount(0);
  });
}

test('桌面窄聊天容器内的表情随面板宽度换行', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 960});
  await openRoom(page);
  await page.locator('.room-layout').evaluate(node => {node.style.width = '320px';});
  await page.getByRole('button', {name: '选择表情', exact: true}).click();
  await page.screenshot({path: testInfo.outputPath('emoji-narrow-container.png'), fullPage: true});
  await expectContainedEmoji(page);
  const panel = await page.locator('.emoji-panel').boundingBox();
  const room = await page.locator('.room-layout').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(room!.x);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(room!.x + room!.width);
  await page.getByRole('button', {name: '插入表情 🍀', exact: true}).click();
  await expect(page.getByRole('textbox', {name: '咨询消息'})).toHaveValue('🍀');
});

test('短屏表情面板可滚动且不超出视口', async ({page}, testInfo) => {
  await page.setViewportSize({width: 360, height: 300});
  await openRoom(page);
  await page.getByRole('button', {name: '选择表情', exact: true}).click();
  await expectContainedEmoji(page);
  expect(await page.locator('.emoji-panel').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  const lastEmoji = page.getByRole('button', {name: '插入表情 🍀', exact: true});
  await lastEmoji.scrollIntoViewIfNeeded();
  await lastEmoji.click();
  await expect(page.getByRole('textbox', {name: '咨询消息'})).toHaveValue('🍀');
  await page.screenshot({path: testInfo.outputPath('emoji-short-screen.png'), fullPage: true});
  await page.getByRole('button', {name: '关闭表情', exact: true}).click();
  await expect(page.locator('.emoji-panel')).toHaveCount(0);
});
