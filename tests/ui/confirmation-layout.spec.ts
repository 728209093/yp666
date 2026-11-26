import {test, expect} from '@playwright/test';
import {defaultDocument} from '../../packages/shared/src/index';

for (const viewport of [{width: 1920, height: 1080}, {width: 390, height: 844}]) {
  test(`发布确认弹窗居中且宽度适配屏幕（${viewport.width}px）`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
      else if (path === '/api/admin/content' && route.request().method() === 'GET') {
        await route.fulfill({json: {draft: defaultDocument, published: defaultDocument, publishedAt: null}});
      } else {
        await route.fulfill({status: 500, json: {message: `Unexpected request: ${path}`}});
        throw new Error(`Unexpected request: ${path}`);
      }
    });
    await page.goto('/#settings');
    const publish = page.getByRole('button', {name: '发布到前台', exact: true});
    await expect(publish).toBeEnabled();
    await publish.click();
    const dialog = page.getByRole('dialog', {name: '发布当前版本', exact: true});
    const panel = dialog.locator('.el-message-box');
    await expect(dialog).toBeVisible();
    // Wait for the entry animation before measuring its final position.
    await expect.poll(async () => dialog.evaluate(node => node.getAnimations({subtree: true}).length)).toBe(0);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(421);
    expect(box!.x).toBeGreaterThanOrEqual(15);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 15);
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(4);
    for (const name of ['再检查一下', '确认发布']) {
      const button = dialog.getByRole('button', {name, exact: true});
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(box!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(box!.x + box!.width);
    }
    await page.screenshot({path: `test-results/publish-confirmation-${viewport.width}.png`});
    await dialog.getByRole('button', {name: '再检查一下', exact: true}).click();
    await expect(dialog).toBeHidden();
  });
}
