import {test, expect, type Page, type Route} from '@playwright/test';
import {defaultDocument, type ConversationSummary} from '../../packages/shared/src/index';

const clip = {name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from('mock-upload-video')};
const summary: ConversationSummary = {id: 'progress-chat', visitorLabel: '进度测试访客', lastMessage: '你好', unreadCount: 0, createdAt: '2026-11-26T00:00:00Z', updatedAt: '2026-11-26T00:00:00Z'};

async function setup(page: Page, onSend?: (route: Route) => Promise<void>) {
  // Control browser upload events independently of the server response. Every
  // non-upload API call is still routed, so these tests never reach a database.
  await page.addInitScript(() => {
    const NativeXHR = window.XMLHttpRequest;
    const pending: XMLHttpRequest[] = [];
    (window as any).__uploads = pending;
    class ControlledUpload extends NativeXHR {
      mocked = false;
      aborted = false;
      open(method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
        this.mocked = String(url) === '/api/admin/uploads';
        if (!this.mocked) super.open(method, url, async, username, password);
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        if (this.mocked) {pending.push(this); return;}
        super.send(body);
      }
      abort() {
        if (!this.mocked) {super.abort(); return;}
        this.aborted = true;
        this.dispatchEvent(new Event('abort'));
      }
    }
    window.XMLHttpRequest = ControlledUpload;
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
    else if (path === '/api/admin/content') await route.fulfill({json: {draft: defaultDocument, published: defaultDocument, publishedAt: null}});
    else if (path === '/api/admin/conversations') await route.fulfill({json: [summary]});
    else if (path === '/api/admin/conversations/progress-chat') await route.fulfill({json: {conversation: summary, messages: []}});
    else if (path === '/api/admin/conversations/progress-chat/messages' && onSend) await onSend(route);
    else {
      await route.fulfill({status: 500, json: {message: 'Unexpected mocked request'}});
      throw new Error(`Unexpected API request: ${path}`);
    }
  });
  await page.route('**/uploads/**', route => route.fulfill({status: 404, body: ''}));
  await page.route('**/uploads/progress-video.webm', route => route.fulfill({contentType: 'video/webm', body: Buffer.alloc(0)}));
}

async function uploadCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => (window as any).__uploads.length)).toBe(count);
}

async function progress(page: Page, loaded: number, known = true) {
  await page.evaluate(({loaded, known}) => {
    const xhr = (window as any).__uploads.at(-1) as XMLHttpRequest;
    xhr.upload.dispatchEvent(new ProgressEvent('progress', {loaded, total: known ? 100 : 0, lengthComputable: known}));
    if (known && loaded === 100) xhr.upload.dispatchEvent(new ProgressEvent('load'));
  }, {loaded, known});
}

async function respond(page: Page, status = 200, body: object = {url: '/uploads/progress-video.webm', type: 'video', fileName: 'clip.webm'}) {
  await page.evaluate(({status, body}) => {
    const xhr = (window as any).__uploads.at(-1) as XMLHttpRequest;
    Object.defineProperties(xhr, {status: {value: status, configurable: true}, responseText: {value: JSON.stringify(body), configurable: true}});
    xhr.dispatchEvent(new Event('load'));
  }, {status, body});
}

async function chooseContentVideo(page: Page) {
  await page.goto('/#content');
  await page.getByRole('button', {name: '视频', exact: true}).click();
  await page.getByLabel('上传内容视频', {exact: true}).setInputFiles(clip);
  await uploadCount(page, 1);
}

test('内容视频显示真实进度，传完后等待处理成功再显示预览', async ({page}) => {
  await setup(page);
  await chooseContentVideo(page);
  const bar = page.getByRole('progressbar', {name: '视频上传进度'});
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('value');
  expect(await page.evaluate(() => (window as any).__uploads[0].withCredentials)).toBe(true);
  for (const percentage of [25, 75, 100]) {
    await progress(page, percentage);
    await expect(bar).toHaveAttribute('value', String(percentage));
    await expect(page.locator('.upload-progress')).toContainText(`${percentage}%`);
  }
  await expect(page.locator('.upload-progress')).toContainText('上传完成，正在处理…');
  await expect(page.getByLabel('视频 URL', {exact: true})).toHaveValue('');
  await respond(page);
  await expect(bar).toHaveCount(0);
  await expect(page.getByLabel('视频 URL', {exact: true})).toHaveValue('/uploads/progress-video.webm');
  await expect(page.getByLabel('视频预览', {exact: true})).toBeVisible();
});

test('未知总长度使用不定进度；失败和取消后可重新上传同一文件', async ({page}) => {
  await setup(page);
  await chooseContentVideo(page);
  const bar = page.getByRole('progressbar', {name: '视频上传进度'});
  await progress(page, 12, false);
  await expect(bar).not.toHaveAttribute('value');
  await page.evaluate(() => (window as any).__uploads.at(-1).dispatchEvent(new Event('error')));
  await expect(page.getByRole('alert')).toContainText('请检查网络后重试');
  await expect(bar).toHaveCount(0);
  await page.getByLabel('上传内容视频', {exact: true}).setInputFiles(clip);
  await uploadCount(page, 2);
  await progress(page, 75);
  await page.getByRole('button', {name: '取消上传', exact: true}).click();
  await expect(bar).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__uploads.at(-1).aborted)).toBe(true);
  await expect(page.getByLabel('视频 URL', {exact: true})).toHaveValue('');
  await page.getByLabel('上传内容视频', {exact: true}).setInputFiles(clip);
  await uploadCount(page, 3);
  await respond(page);
  await expect(page.getByLabel('视频 URL', {exact: true})).toHaveValue('/uploads/progress-video.webm');
});

test('聊天视频上传进度与发送状态分开显示，成功前不发送消息', async ({page}) => {
  let sendRoute: Route | undefined;
  await setup(page, async route => {sendRoute = route;});
  await page.goto('/#messages');
  await page.locator('.conversation-row').click();
  await page.getByRole('button', {name: '视频', exact: true}).click();
  await page.getByLabel('上传聊天媒体', {exact: true}).setInputFiles(clip);
  await uploadCount(page, 1);
  const bar = page.getByRole('progressbar', {name: '视频上传进度'});
  for (const percentage of [25, 75, 100]) {
    await progress(page, percentage);
    await expect(bar).toHaveAttribute('value', String(percentage));
  }
  await expect(page.locator('.upload-progress')).toContainText('正在处理');
  expect(sendRoute).toBeUndefined();
  await respond(page);
  await expect.poll(() => Boolean(sendRoute)).toBe(true);
  await expect(page.locator('.upload-progress')).toContainText('正在发送…');
  await expect(page.getByRole('button', {name: '取消上传', exact: true})).toHaveCount(0);
  expect(sendRoute!.request().postDataJSON()).toEqual({type: 'video', mediaUrl: '/uploads/progress-video.webm', fileName: 'clip.webm', content: ''});
  await sendRoute!.fulfill({json: [{id: 'sent-video', role: 'admin', type: 'video', content: '', mediaUrl: '/uploads/progress-video.webm', fileName: 'clip.webm', createdAt: summary.createdAt}]});
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.admin-messages video')).toBeVisible();
});

test('上传的超时与服务器错误能恢复重试，401 返回登录界面', async ({page}) => {
  await setup(page);
  await chooseContentVideo(page);
  const input = page.getByLabel('上传内容视频', {exact: true});
  await page.evaluate(() => (window as any).__uploads.at(-1).dispatchEvent(new Event('timeout')));
  await expect(page.getByRole('alert')).toContainText('上传超时');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await input.setInputFiles(clip);
  await uploadCount(page, 2);
  await respond(page, 413, {message: ['文件过大', '请重试']});
  await expect(page.getByRole('alert').last()).toContainText('文件过大；请重试');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await input.setInputFiles(clip);
  await uploadCount(page, 3);
  await respond(page, 401, {message: '登录已过期'});
  await expect(page.getByRole('button', {name: '进入工作台'})).toBeVisible();
});

test('离开内容编辑页会中断尚未完成的视频上传', async ({page}) => {
  await setup(page);
  await chooseContentVideo(page);
  await progress(page, 25);
  await page.getByRole('button', {name: '访客咨询', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__uploads[0].aborted)).toBe(true);
});
