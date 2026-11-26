import {test, expect, type Locator, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defaultDocument, type ChatMessage, type SiteDocument} from '../../packages/shared/src/index';

const fixture = readFileSync(resolve('tests/fixtures/browser-recorded.webm'));
const portraitFixture = readFileSync(resolve('tests/fixtures/portrait-video.webm'));
const createdAt = '2026-11-26T04:00:00Z';
const videoMessage: ChatMessage = {id: 'video', role: 'admin', type: 'video', content: '', mediaUrl: '/uploads/centered.webm', fileName: '聊天视频', createdAt};

async function mockWeb(page: Page, media = fixture) {
  const document = structuredClone(defaultDocument);
  document.settings.verificationEnabled = false;
  document.settings.welcomeMessage = '';
  document.blocks = [{
    id: 'published-video', type: 'video', title: '发布视频', videoUrl: '/uploads/centered.webm',
    content: '', imageUrl: '', contentFormat: 'plain', buttonText: '', url: '', enabled: true, sortOrder: 0,
  }] as SiteDocument['blocks'];
  document.faqs = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/public/bootstrap') await route.fulfill({json: {site: document.settings, verificationRequired: false, verified: true, captchaProvider: 'local'}});
    else if (path === '/api/public/content') await route.fulfill({json: document});
    else if (path === '/api/visitor/messages' && route.request().method() === 'GET') await route.fulfill({json: [videoMessage]});
    else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.route('**/uploads/centered.webm', route => route.fulfill({contentType: 'video/webm', body: media}));
  await page.goto('http://127.0.0.1:5273');
  await expect(page.locator('.loading-screen')).toBeHidden();
}

async function expectCenter(player: Locator) {
  await player.scrollIntoViewIfNeeded();
  const video = player.locator('video');
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  const button = player.getByRole('button');
  await expect(button).toBeVisible();
  const frame = (await video.boundingBox())!;
  const play = (await button.boundingBox())!;
  expect(Math.abs(play.x + play.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1);
  expect(Math.abs(play.y + play.height / 2 - frame.y - frame.height / 2)).toBeLessThan(1);
  expect(await video.evaluate(node => {
    const video = node as HTMLVideoElement;
    return {paused: video.paused, autoplay: video.autoplay, controls: video.controls, playsInline: video.playsInline};
  })).toEqual({paused: true, autoplay: false, controls: true, playsInline: true});
}

for (const viewport of [{width: 390, height: 844}, {width: 1440, height: 960}]) {
  test(`发布视频与聊天视频播放按钮位于画面正中心，点击后播放（${viewport.width}px）`, async ({page}) => {
    await page.setViewportSize(viewport);
    await mockWeb(page);
    const players = page.locator('.video-player');
    await expect(players).toHaveCount(2);
    for (const player of await players.all()) await expectCenter(player);
    const player = players.last();
    const video = player.locator('video');
    // Keep this very short fixture running while asserting the controls state.
    await video.evaluate(node => {(node as HTMLVideoElement).loop = true;});
    await player.getByRole('button').click();
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
    await expect(player.getByRole('button')).toHaveCount(0);
    await video.evaluate(node => (node as HTMLVideoElement).pause());
    await expectCenter(player);
    await page.screenshot({path: `test-results/video-centered-${viewport.width}.png`, fullPage: true});
    await player.getByRole('button').click();
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
    await expect(player.getByRole('button')).toHaveCount(0);
    await video.evaluate(node => {(node as HTMLVideoElement).loop = false;});
    await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).ended)).toBe(true);
    await expectCenter(player);
  });
}

test('后台聊天视频显示居中播放按钮并等待点击', async ({page}) => {
  const conversation = {id: 'one', visitorLabel: '视频访客', lastMessage: '聊天视频', unreadCount: 0, createdAt, updatedAt: createdAt};
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
    else if (path === '/api/admin/content') await route.fulfill({json: {draft: defaultDocument, published: defaultDocument, publishedAt: createdAt}});
    else if (path === '/api/admin/conversations') await route.fulfill({json: [conversation]});
    else if (path === '/api/admin/conversations/one') await route.fulfill({json: {conversation, messages: [videoMessage]}});
    else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.route('**/uploads/centered.webm', route => route.fulfill({contentType: 'video/webm', body: fixture}));
  await page.goto('/#messages');
  await page.locator('.conversation-row').click();
  const player = page.locator('.media-message-bubble .video-player');
  await expectCenter(player);
  const video = player.locator('video');
  await video.evaluate(node => {(node as HTMLVideoElement).loop = true;});
  await player.getByRole('button').click();
  await expect.poll(() => video.evaluate(node => (node as HTMLVideoElement).paused)).toBe(false);
  await expect(player.getByRole('button')).toHaveCount(0);
});

test('播放失败保留中心按钮，允许再次点击重试', async ({page}) => {
  await mockWeb(page);
  const player = page.locator('.message-video');
  const video = player.locator('video');
  await video.evaluate(node => {
    (node as HTMLVideoElement).play = () => Promise.reject(new DOMException('Playback blocked', 'NotAllowedError'));
  });
  await player.getByRole('button').click();
  await expect(player.getByRole('status')).toHaveText('视频暂时无法播放，请重试');
  await expectCenter(player);
});

test('竖屏视频保持完整画面，播放按钮仍在中心', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockWeb(page, portraitFixture);
  for (const player of await page.locator('.video-player').all()) {
    await expectCenter(player);
    expect(await player.locator('video').evaluate(node => {
      const video = node as HTMLVideoElement;
      return {portrait: video.videoHeight > video.videoWidth, fit: getComputedStyle(video).objectFit};
    })).toEqual({portrait: true, fit: 'contain'});
  }
});
