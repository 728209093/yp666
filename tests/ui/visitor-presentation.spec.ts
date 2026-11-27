import {test, expect, type Locator, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defaultDocument, type ChatMessage, type SiteDocument} from '../../packages/shared/src/index';

const webUrl = 'http://127.0.0.1:5273';
const now = new Date('2026-11-26T04:00:00.000Z');
const createdAt = '2026-11-26T02:00:00.000Z';
// Chromium-recorded VP8; duration header removed to model a browser live recording.
const videoFixture = readFileSync(resolve('tests/fixtures/browser-recorded.webm'));

function documentWith(blocks: Record<string, unknown>[] = []): SiteDocument {
  return {
    ...structuredClone(defaultDocument),
    settings: {...defaultDocument.settings, welcomeMessage: '', announcement: '手机顶部滚动公告', verificationEnabled: false},
    blocks: blocks.map((block, sortOrder) => ({
      id: `block-${sortOrder}`, title: '', content: '', imageUrl: '', videoUrl: '', contentFormat: 'plain',
      buttonText: '', url: '', enabled: true, sortOrder, ...block,
    })),
    faqs: [],
  } as SiteDocument;
}

async function mockRoom(page: Page, document: SiteDocument, messages: ChatMessage[] = []) {
  await page.clock.setFixedTime(now);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/public/bootstrap') {
      await route.fulfill({json: {site: document.settings, verificationRequired: false, verified: true, captchaProvider: 'local'}});
    } else if (path === '/api/public/content') {
      await route.fulfill({json: document});
    } else if (path === '/api/visitor/messages' && route.request().method() === 'GET') {
      await route.fulfill({json: messages});
    } else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.route('**/assets/test-*.svg', route => {
    const portrait = route.request().url().includes('portrait');
    const width = portrait ? 300 : 1200;
    const height = portrait ? 900 : 300;
    return route.fulfill({contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#cfdec5"/><rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="#547861" stroke-width="8"/></svg>`});
  });
  await page.route('**/uploads/test-video.webm', route => route.fulfill({contentType: 'video/webm', body: videoFixture}));
  await page.goto(webUrl);
  await expect(page.getByRole('textbox', {name: '咨询消息'})).toBeVisible();
  await expect(page.locator('.loading-screen')).toBeHidden();
}

async function expectOriginalRatio(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const dimensions = await image.evaluate(node => {
    const image = node as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return {width: box.width, height: box.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight};
  });
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height / dimensions.width).toBeCloseTo(dimensions.naturalHeight / dimensions.naturalWidth, 2);
}

for (const viewport of [{width: 390, height: 844}, {width: 768, height: 1024}, {width: 1440, height: 960}]) {
  test(`图片完整保留原比例，输入图标在右侧（${viewport.width}px）`, async ({page}) => {
    await page.setViewportSize(viewport);
    await mockRoom(page, documentWith([
      {type: 'image', title: '竖图完整展示', imageUrl: '/assets/test-portrait.svg'},
      {type: 'image', title: '横图完整展示', imageUrl: '/assets/test-landscape.svg'},
    ]), [{id: 'image-message', role: 'admin', type: 'image', content: '', mediaUrl: '/assets/test-portrait.svg', fileName: '聊天竖图', createdAt}]);
    for (const image of await page.locator('img.content-card-image, img.message-image').all()) await expectOriginalRatio(image);
    expect(await page.locator('img.content-card-image, img.message-image').count()).toBe(3);
    const input = await page.getByRole('textbox', {name: '咨询消息'}).boundingBox();
    const emoji = await page.getByRole('button', {name: '选择表情', exact: true}).boundingBox();
    const plus = await page.getByRole('button', {name: '发送图片或视频', exact: true}).boundingBox();
    expect(input && emoji && plus).toBeTruthy();
    expect(emoji!.x).toBeGreaterThanOrEqual(input!.x + input!.width);
    expect(plus!.x).toBeGreaterThan(emoji!.x);
    await expect(page.locator('.notification-tools')).toHaveCount(0);
    if (viewport.width <= 768) {
      const top = await page.locator('.room-topline').boundingBox();
      expect(top!.y).toBeCloseTo(0, 0);
      expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBeTruthy();
    }
    await page.locator('.content-card-image').first().scrollIntoViewIfNeeded();
    await page.screenshot({path: `test-results/visitor-images-${viewport.width}.png`, fullPage: true});
  });
}

test('发布视频和聊天视频都等待点击播放', async ({page}) => {
  await page.addInitScript(() => {
    (window as unknown as {videoPlays: number}).videoPlays = 0;
    document.addEventListener('play', () => (window as unknown as {videoPlays: number}).videoPlays++, true);
  });
  await mockRoom(page, documentWith([{type: 'video', title: '发布视频', videoUrl: '/uploads/test-video.webm'}]), [
    {id: 'video-message', role: 'admin', type: 'video', content: '', mediaUrl: '/uploads/test-video.webm', fileName: '聊天视频', createdAt},
  ]);
  const videos = page.locator('.content-card video, .message-video video');
  await expect(videos).toHaveCount(2);
  for (const video of await videos.all()) {
    await video.scrollIntoViewIfNeeded();
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThan(0);
    expect(await video.evaluate(node => {
      const video = node as HTMLVideoElement;
      return {paused: video.paused, autoplay: video.autoplay, controls: video.controls, playsInline: video.playsInline};
    })).toEqual({paused: true, autoplay: false, controls: false, playsInline: true});
  }
  expect(await page.evaluate(() => (window as unknown as {videoPlays: number}).videoPlays)).toBe(0);
  await page.getByRole('button', {name: '播放聊天视频', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {videoPlays: number}).videoPlays)).toBeGreaterThan(0);
});

test('跨天及五分钟间隔显示时间分隔，连续消息不重复显示', async ({page}) => {
  const times = ['2025-12-31T15:59:00Z', '2026-11-25T15:58:00Z', '2026-11-25T16:01:00Z', '2026-11-26T02:00:00Z', '2026-11-26T02:04:00Z', '2026-11-26T02:09:00Z'];
  await mockRoom(page, documentWith(), times.map((createdAt, index) => ({id: `time-${index}`, role: 'visitor', type: 'text', content: `消息${index}`, createdAt})));
  const labels = await page.locator('.message-time-divider').allTextContents();
  expect(labels.map(text => text.trim())).toEqual(['2025年12月31日 23:59', '昨天 23:58', '00:01', '10:00', '10:09']);
});

test('发布富文本保留字号颜色格式，历史纯文本不作为 HTML 解析', async ({page}) => {
  await mockRoom(page, documentWith([
    {type: 'text', contentFormat: 'richtext', content: '<p style="text-align:center"><strong><span style="font-size:24px;color:#e53935;font-family:Georgia">格式化发布内容</span></strong></p>'},
    {type: 'text', content: '<b>历史纯文本</b>'},
  ]));
  const formatted = page.getByText('格式化发布内容', {exact: true});
  await expect(formatted).toBeVisible();
  const style = await formatted.evaluate(node => {
    const style = getComputedStyle(node);
    return {size: style.fontSize, color: style.color, weight: Number(style.fontWeight), family: style.fontFamily, alignment: style.textAlign};
  });
  expect(style.size).toBe('24px');
  expect(style.color).toBe('rgb(229, 57, 53)');
  expect(style.weight).toBeGreaterThanOrEqual(600);
  expect(style.family).toContain('Georgia');
  expect(style.alignment).toBe('center');
  await expect(page.getByText('<b>历史纯文本</b>', {exact: true})).toBeVisible();
  await page.screenshot({path: 'test-results/visitor-rich-content.png', fullPage: true});
});
