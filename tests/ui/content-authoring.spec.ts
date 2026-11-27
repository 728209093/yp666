import {test, expect} from '@playwright/test';
import {defaultDocument, type SiteDocument} from '../../packages/shared/src/index';

test('发布正文可保存字体、字号、颜色，内容视频等待点击播放', async ({page}) => {
  const document = structuredClone(defaultDocument);
  document.blocks = [{...document.blocks[0]!, title: '发布文档', content: '原始纯文字 <b>保持文字</b>'}];
  let saved: SiteDocument | undefined;
  let published: SiteDocument | undefined;
  let uploads = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
    else if (path === '/api/admin/uploads') {uploads++; await route.fulfill({json: {type: 'video', url: '/uploads/content-video.webm', fileName: 'clip.webm'}});}
    else if (path === '/api/admin/content') {
      if (request.method() === 'PUT') saved = request.postDataJSON().document;
      await route.fulfill({json: {draft: saved || document, published: published || document, publishedAt: published ? '2026-11-26T04:00:00Z' : null}});
    } else if (path === '/api/admin/content/publish') {
      expect(request.method()).toBe('POST');
      published = structuredClone(saved!);
      await route.fulfill({json: {draft: saved, published, publishedAt: '2026-11-26T04:00:00Z'}});
    } else throw new Error(`Unexpected API request: ${path}`);
  });
  await page.route('**/uploads/content-video.webm', route => route.fulfill({status: 200, contentType: 'video/webm', body: Buffer.alloc(0)}));
  await page.goto('/#content');
  await page.getByRole('button', {name: /发布文档/}).click();
  const editor = page.getByRole('textbox', {name: '正文内容', exact: true}).first();
  await expect(editor).toContainText('原始纯文字 <b>保持文字</b>');
  await editor.fill('字体测试');
  await editor.press('ControlOrMeta+A');
  await page.getByLabel('文字字体', {exact: true}).first().selectOption('Georgia');
  await editor.press('ControlOrMeta+A');
  await page.getByLabel('文字字号', {exact: true}).first().selectOption('24');
  await editor.press('ControlOrMeta+A');
  await page.getByRole('button', {name: '加粗', exact: true}).first().click();
  await editor.press('ControlOrMeta+A');
  await page.getByLabel('正文内容文字颜色', {exact: true}).first().evaluate((input: HTMLInputElement) => {
    input.value = '#e60000'; input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect.poll(() => saved?.blocks[0]?.content).toContain('font-size: 24px');
  expect(saved!.blocks[0]!.contentFormat).toBe('richtext');
  expect(saved!.blocks[0]!.content).toContain('Georgia');
  expect(saved!.blocks[0]!.content).toMatch(/<(?:b|strong)(?:>|\s)/);
  expect(saved!.blocks[0]!.content).toMatch(/rgb\(230, 0, 0\)|#e60000/);
  await page.getByRole('button', {name: '视频', exact: true}).click();
  await page.getByLabel('上传内容视频', {exact: true}).setInputFiles({name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from('mock-video-upload')});
  await expect(page.getByLabel('视频 URL', {exact: true})).toHaveValue('/uploads/content-video.webm');
  expect(uploads).toBe(1);
  const video = page.getByLabel('视频预览', {exact: true});
  await expect(video).not.toHaveAttribute('controls');
  await expect(page.getByRole('button', {name: '播放视频预览', exact: true})).toBeVisible();
  expect(await video.evaluate((element: HTMLVideoElement) => ({autoplay: element.autoplay, paused: element.paused}))).toEqual({autoplay: false, paused: true});
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await expect.poll(() => saved?.blocks.length).toBe(2);
  expect(saved!.blocks[1]!.type).toBe('video');
  expect(saved!.blocks[1]!.videoUrl).toBe('/uploads/content-video.webm');
  await page.getByRole('button', {name: '发布到前台', exact: true}).click();
  await page.getByRole('button', {name: '确认发布', exact: true}).click();
  await expect.poll(() => published?.blocks.length).toBe(2);
  expect(published!.blocks[0]!.contentFormat).toBe('richtext');
  expect(published!.blocks[0]!.content).toContain('font-size: 24px');
  expect(published!.blocks[1]!.videoUrl).toBe('/uploads/content-video.webm');
});
