import {test, expect, type Page} from '@playwright/test';
import {defaultDocument, type SiteDocument} from '../../packages/shared/src/index';

const webUrl = 'http://127.0.0.1:5273';
const backdrop = '/assets/appearance-backdrop.svg';
const firstIcon = '/assets/appearance-icon-a.svg';
const nextIcon = '/assets/appearance-icon-b.svg';
const defaultIcon = '/assets/favicon.svg';

function appearanceDocument(): SiteDocument {
  return {
    ...structuredClone(defaultDocument),
    settings: {
      ...defaultDocument.settings,
      brandName: '在线客服', welcomeMessage: '您好，请问有什么可以帮您？',
      verificationEnabled: false, chatBackgroundUrl: backdrop,
      serviceNameFontSize: 14, faviconUrl: firstIcon,
    },
    blocks: [],
    faqs: [{id: 'appearance-faq', question: '这里可以了解哪些服务？', answer: '欢迎留言咨询。', enabled: true}],
  };
}

async function mockAppearance(page: Page, initial: SiteDocument, verified = true) {
  await page.clock.install({time: new Date('2026-11-27T04:00:00.000Z')});
  let published = structuredClone(initial);
  let contentRequests = 0;
  await page.route('**/assets/appearance-*.svg', async route => {
    if (route.request().url().includes('missing')) {
      await route.fulfill({status: 404, body: 'Not found'});
      return;
    }
    const color = route.request().url().includes('backdrop') ? '#c7d6e4' : route.request().url().includes('icon-b') ? '#9e3544' : '#294f7f';
    await route.fulfill({contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${color}"/><circle cx="60" cy="60" r="26" fill="#ffffff"/></svg>`});
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/public/bootstrap') await route.fulfill({json: {site: initial.settings, verificationRequired: !verified, verified, captchaProvider: 'local'}});
    else if (path === '/api/public/content' && verified) {contentRequests++; await route.fulfill({json: published});}
    else if (path === '/api/visitor/messages' && verified && route.request().method() === 'GET') await route.fulfill({json: []});
    else if (path === '/api/verification/challenge' && !verified) await route.fulfill({json: {id: 'appearance-challenge', kind: 'slider', background: '', piece: '', width: 320, height: 180, pieceSize: 44, pieceY: 80, expiresAt: '2026-11-27T04:10:00.000Z'}});
    else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.goto(webUrl);
  await expect(page.locator('.loading-screen')).toBeHidden();
  if (verified) await expect(page.getByRole('textbox', {name: '咨询消息'})).toBeVisible();
  else await expect(page.locator('.verification-dialog')).toBeVisible();
  return {
    publish(document: SiteDocument) {published = structuredClone(document);},
    requests: () => contentRequests,
  };
}

async function iconPath(page: Page, rel = 'icon') {
  return page.locator(`head link[rel="${rel}"]`).evaluate((link: HTMLLinkElement) => new URL(link.href).pathname);
}

async function expectReadableFaq(page: Page) {
  const colors = await page.locator('.faq-chip').first().evaluate(node => {
    const style = getComputedStyle(node);
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (channels: number[]) => channels.map(channel => {
      const s = channel / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const foreground = luminance(rgb(style.color)), background = luminance(rgb(style.backgroundColor));
    return {ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), color: style.color};
  });
  expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
  // The shortcut text should use a neutral dark color rather than the previous pale green.
  expect(colors.color).not.toBe('rgb(115, 137, 96)');
}

for (const [width, size] of [[320, 14], [390, 16], [1440, 18]] as const) {
  test(`客服字号受控、文字清晰且背景覆盖页面边缘（${width}px）`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 844});
    const document = appearanceDocument();
    document.settings.serviceNameFontSize = size;
    await mockAppearance(page, document);
    await expect(page.locator('.assistant-message .message-author').first()).toHaveCSS('font-size', `${size}px`);
    await expectReadableFaq(page);
    const edges = await page.locator('.site-shell').evaluate(node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return {left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        background: style.backgroundImage, size: style.backgroundSize, color: style.backgroundColor,
        width: window.innerWidth, height: window.innerHeight, pageWidth: window.document.documentElement.scrollWidth};
    });
    expect(edges.background).toContain(backdrop);
    expect(edges.size.split(',').every(size => size.trim() === 'cover')).toBe(true);
    expect(edges.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(edges.left).toBe(0);
    expect(edges.top).toBe(0);
    expect(edges.right).toBe(edges.width);
    expect(edges.bottom).toBe(edges.height);
    expect(edges.pageWidth).toBeLessThanOrEqual(edges.width);
    if (width <= 390) {
      const room = await page.locator('.room-layout').boundingBox();
      expect(room!.x).toBe(0);
      expect(room!.y).toBe(0);
      expect(room!.width).toBe(width);
    }
    await expect.poll(() => iconPath(page)).toBe(firstIcon);
    await page.screenshot({path: testInfo.outputPath(`appearance-${width}.png`), fullPage: true});
  });
}

test('发布后的名称字号和标签图标自动同步，清空图标恢复默认', async ({page}) => {
  const document = appearanceDocument();
  const mock = await mockAppearance(page, document);
  await expect.poll(() => iconPath(page)).toBe(firstIcon);
  await expect.poll(() => iconPath(page, 'apple-touch-icon')).toBe(firstIcon);
  const update = structuredClone(document);
  update.settings.serviceNameFontSize = 100;
  update.settings.faviconUrl = nextIcon;
  mock.publish(update);
  await page.clock.runFor(16000);
  await expect.poll(mock.requests).toBeGreaterThan(1);
  await expect(page.locator('.assistant-message .message-author').first()).toHaveCSS('font-size', '18px');
  await expect.poll(() => iconPath(page)).toBe(nextIcon);
  await expect.poll(() => iconPath(page, 'apple-touch-icon')).toBe(nextIcon);
  const clear = structuredClone(update);
  clear.settings.faviconUrl = '';
  mock.publish(clear);
  const before = mock.requests();
  await page.clock.runFor(16000);
  await expect.poll(mock.requests).toBeGreaterThan(before);
  await expect.poll(() => iconPath(page)).toBe(defaultIcon);
  await expect.poll(() => iconPath(page, 'apple-touch-icon')).toBe(defaultIcon);
});

test('未进入聊天的验证页也使用后台设置的标签图标', async ({page}) => {
  const document = appearanceDocument();
  document.settings.verificationEnabled = true;
  const mock = await mockAppearance(page, document, false);
  await expect.poll(() => iconPath(page)).toBe(firstIcon);
  await expect.poll(() => iconPath(page, 'apple-touch-icon')).toBe(firstIcon);
  expect(mock.requests()).toBe(0);
});

test('图标资源不可用时回退默认，旧设置缺少字号仍正常显示', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const document = appearanceDocument();
  document.settings.faviconUrl = '/assets/appearance-missing.svg';
  delete (document.settings as Partial<SiteDocument['settings']>).serviceNameFontSize;
  await mockAppearance(page, document);
  await expect.poll(() => iconPath(page)).toBe(defaultIcon);
  await expect.poll(() => iconPath(page, 'apple-touch-icon')).toBe(defaultIcon);
  await expect(page.locator('.assistant-message .message-author').first()).toHaveCSS('font-size', '14px');
  expect(errors).toEqual([]);
});
