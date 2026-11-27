import {test, expect, type Page} from '@playwright/test';
import {defaultDocument, type SiteDocument} from '../../packages/shared/src/index';

async function mockSettings(page: Page, legacy = false) {
  const original = structuredClone(defaultDocument);
  original.blocks = [];
  if (legacy) {
    delete (original.settings as Partial<SiteDocument['settings']>).serviceNameFontSize;
    delete (original.settings as Partial<SiteDocument['settings']>).faviconUrl;
  }
  let saved: SiteDocument | undefined;
  let published: SiteDocument | undefined;
  let uploads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
    else if (path === '/api/admin/content' && ['GET', 'PUT'].includes(request.method())) {
      if (request.method() === 'PUT') saved = request.postDataJSON().document;
      await route.fulfill({json: {draft: saved || original, published: published || original, publishedAt: null}});
    } else if (path === '/api/admin/content/publish' && request.method() === 'POST') {
      published = structuredClone(saved!);
      await route.fulfill({json: {draft: saved, published, publishedAt: '2026-11-27T04:00:00Z'}});
    } else if (path === '/api/admin/uploads' && request.method() === 'POST') {
      uploads++;
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      await route.fulfill({json: {url: '/uploads/brand-icon.webp', type: 'image', fileName: 'brand-icon.png'}});
    } else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.route('**/uploads/brand-icon.webp', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#334155"/></svg>',
  }));
  await page.goto('/#settings');
  await expect(page.getByRole('spinbutton', {name: '客服名称字号', exact: true})).toBeVisible();
  return {saved: () => saved, published: () => published, uploads: () => uploads};
}

test('客服字号加载旧配置默认值、限制范围，并连同图标设置保存发布', async ({page}, testInfo) => {
  const state = await mockSettings(page, true);
  const size = page.getByRole('spinbutton', {name: '客服名称字号', exact: true});
  await expect(size).toHaveValue('14');
  await expect(size).toHaveAttribute('aria-valuemin', '12');
  await expect(size).toHaveAttribute('aria-valuemax', '18');
  await size.fill('99');
  await size.blur();
  await expect(size).toHaveValue('18');
  await size.fill('1');
  await size.blur();
  await expect(size).toHaveValue('12');
  await size.fill('16');
  await size.blur();
  await page.getByLabel('标签页图标图片 URL', {exact: true}).fill('/uploads/brand-icon.webp');
  await page.getByRole('button', {name: '预览草稿', exact: true}).click();
  await expect(page.locator('.preview-service-name')).toContainText('青屿');
  await expect(page.locator('.preview-service-name')).toHaveCSS('font-size', '16px');
  await page.screenshot({path: testInfo.outputPath('service-name-preview.png'), fullPage: true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', {name: '草稿预览'})).toBeHidden();
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect.poll(() => state.saved()?.settings.serviceNameFontSize).toBe(16);
  expect(state.saved()?.settings.faviconUrl).toBe('/uploads/brand-icon.webp');
  await page.getByRole('button', {name: '发布到前台', exact: true}).click();
  await page.getByRole('button', {name: '确认发布', exact: true}).click();
  await expect.poll(() => state.published()?.settings.serviceNameFontSize).toBe(16);
  expect(state.published()?.settings.faviconUrl).toBe('/uploads/brand-icon.webp');
});

test('标签页图标可上传、预览和清空，清空后保存默认图标设置', async ({page}) => {
  const state = await mockSettings(page);
  const icon = page.locator('.favicon-setting');
  const image = icon.getByRole('img', {name: '标签页图标图片 URL', exact: true});
  await expect(icon.getByLabel('标签页图标图片 URL', {exact: true})).toHaveValue('');
  await icon.locator('input[type=file]').setInputFiles({name: 'brand-icon.png', mimeType: 'image/png', buffer: Buffer.from('mock-image-upload')});
  await expect(icon.getByLabel('标签页图标图片 URL', {exact: true})).toHaveValue('/uploads/brand-icon.webp');
  await expect(image).toBeVisible();
  expect(state.uploads()).toBe(1);
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect.poll(() => state.saved()?.settings.faviconUrl).toBe('/uploads/brand-icon.webp');
  await icon.getByRole('button', {name: '移除图片', exact: true}).click();
  await expect(icon.getByLabel('标签页图标图片 URL', {exact: true})).toHaveValue('');
  await expect(image).toHaveCount(0);
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect.poll(() => state.saved()?.settings.faviconUrl).toBe('');
  expect(state.saved()?.settings.serviceNameFontSize).toBe(14);
});
