import {test, expect} from '@playwright/test';
import {defaultDocument, type SiteDocument} from '../../packages/shared/src/index';

for (const unavailable of ['randomUUID', 'crypto'] as const) {
  test(`缺少 ${unavailable} 时仍可新增内容模块和常见问题`, async ({page}) => {
    const document = structuredClone(defaultDocument);
    document.blocks = [];
    document.faqs = [];
    let saved: SiteDocument | undefined;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(unavailable => {
      if (unavailable === 'crypto') Object.defineProperty(window, 'crypto', {value: undefined, configurable: true});
      else Object.defineProperty(window.crypto, 'randomUUID', {value: undefined, configurable: true});
    }, unavailable);
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
      else if (path === '/api/admin/content' && ['GET', 'PUT'].includes(request.method())) {
        if (request.method() === 'PUT') saved = request.postDataJSON().document;
        await route.fulfill({json: {draft: saved || document, published: document, publishedAt: null}});
      } else {
        await route.fulfill({status: 500, json: {message: `Unexpected request: ${path}`}});
        throw new Error(`Unexpected request: ${path}`);
      }
    });
    await page.goto('/#content');
    await expect(page.getByRole('button', {name: '添加文字模块', exact: true})).toBeVisible();
    for (const [index, name] of ['文字', '图片', '视频', '链接按钮', '文字'].entries()) {
      await page.locator('.add-block-bar').getByRole('button', {name, exact: true}).click();
      await expect(page.locator('.block-card')).toHaveCount(index + 1);
      // Empty media/link modules must be disabled before the draft can be saved.
      if (['图片', '视频', '链接按钮'].includes(name)) {
        await page.locator('.block-card').nth(index).locator('.el-switch').click();
      }
    }
    await page.getByRole('button', {name: '保存草稿', exact: true}).click();
    await expect.poll(() => saved?.blocks.length).toBe(5);
    await page.getByRole('button', {name: '常见问题', exact: true}).click();
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', {name: '添加问题', exact: true}).click();
      const card = page.locator('.faq-card').nth(index);
      await card.getByPlaceholder('例如：怎样联系人工客服？', {exact: true}).fill(`兼容性问题 ${index + 1}`);
      await card.getByPlaceholder('用简洁、清晰的语言回答这个问题', {exact: true}).fill(`兼容性回答 ${index + 1}`);
    }
    await page.getByRole('button', {name: '保存草稿', exact: true}).click();
    await expect.poll(() => saved?.faqs.length).toBe(2);
    const ids = [...saved!.blocks, ...saved!.faqs].map(item => item.id);
    expect(new Set(ids).size).toBe(7);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(80);
    }
    expect(errors).toEqual([]);
  });
}
