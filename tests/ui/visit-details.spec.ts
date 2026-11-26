import {test, expect, type Page, type Route} from '@playwright/test';
import {defaultDocument, type VisitDetail, type VisitListResponse} from '../../packages/shared/src/index';

const createdAt = '2026-11-25T20:01:02.000Z';
const mobileVisit: VisitDetail = {
  id: 'visit-mobile', visitorId: 'visitor-mobile-001', date: '2026-11-26', verified: true,
  firstSeenAt: createdAt, lastSeenAt: '2026-11-25T20:15:30.000Z', ipAddress: '198.51.100.42',
  deviceType: 'mobile', browser: 'Safari', os: 'iOS',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  referrer: 'https://example.com/welcome',
};
const desktopVisit: VisitDetail = {...mobileVisit, id: 'visit-desktop', visitorId: 'visitor-desktop-002', deviceType: 'desktop', ipAddress: '2001:db8:85a3::8a2e:370:7334', browser: 'Chrome', os: 'Windows', verified: false, referrer: null};
const oldVisit: VisitDetail = {...mobileVisit, id: 'visit-old', visitorId: 'visitor-old-003', deviceType: 'unknown', ipAddress: null, browser: null, os: null, userAgent: null, referrer: null, verified: false};
const response = (items = [mobileVisit, desktopVisit, oldVisit], page = 1, total = items.length): VisitListResponse => ({items, total, page, pageSize: 20, totalPages: Math.ceil(total / 20)});

async function mockAdmin(page: Page, visits: (route: Route, url: URL) => Promise<void>) {
  await page.clock.install({time: new Date('2026-11-25T20:00:00.000Z')});
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/auth/me') await route.fulfill({json: {username: 'admin'}});
    else if (url.pathname === '/api/admin/content') await route.fulfill({json: {draft: defaultDocument, published: defaultDocument, publishedAt: createdAt}});
    else if (url.pathname === '/api/admin/dashboard') await route.fulfill({json: {visitsToday: 3, verifiedToday: 1, totalConversations: 0, unreadConversations: 0, recentVisits: [{date: '2026-11-26', visits: 3, verified: 1}]}});
    else if (url.pathname === '/api/admin/visits') await visits(route, url);
    else {
      await route.fulfill({status: 500, json: {message: `Unexpected mocked API request: ${url.pathname}`}});
      throw new Error(`Unexpected mocked API request: ${url.pathname}`);
    }
  });
}

test('访问明细显示设备、IP、北京时间与旧记录缺失状态', async ({page}, testInfo) => {
  const queries: URLSearchParams[] = [];
  await mockAdmin(page, async (route, url) => {queries.push(url.searchParams); await route.fulfill({json: response()});});
  await page.goto('/#visits');
  await expect(page.getByRole('heading', {name: '访问明细.'})).toBeVisible();
  await expect(page.locator('.visit-table tbody tr')).toHaveCount(3);
  expect(queries[0].get('dateFrom')).toBe('2026-11-26');
  expect(queries[0].get('dateTo')).toBe('2026-11-26');
  await expect(page.locator('.visit-table')).toContainText('198.51.100.42');
  await expect(page.locator('.visit-table')).toContainText('2001:db8:85a3::8a2e:370:7334');
  await expect(page.locator('.visit-table tbody tr').first()).toContainText('手机');
  await expect(page.locator('.visit-table tbody tr').first()).toContainText('2026/11/26 04:01:02');
  await expect(page.locator('.visit-table tbody tr').first()).toContainText('2026/11/26 04:15:30');
  await expect(page.locator('.visit-table tbody tr').nth(1)).toContainText('电脑');
  await expect(page.locator('.visit-table tbody tr').last()).toContainText('未采集');
  await page.locator('.visit-table tbody tr').first().getByText('查看详情').click();
  await expect(page.locator('.visit-table tbody tr').first()).toContainText('https://example.com/welcome');
  await expect(page.locator('.visit-count-note')).toContainText('反复刷新不会累加');
  await page.screenshot({path: testInfo.outputPath('visit-details-desktop.png'), fullPage: true});
});

test('日期、设备、关键词筛选与分页使用已应用条件', async ({page}) => {
  const queries: URLSearchParams[] = [];
  await mockAdmin(page, async (route, url) => {
    queries.push(url.searchParams);
    const currentPage = Number(url.searchParams.get('page'));
    await route.fulfill({json: {...response(currentPage === 2 ? [desktopVisit] : [mobileVisit], currentPage, 21), pageSize: Number(url.searchParams.get('pageSize'))}});
  });
  await page.goto('/#visits');
  await expect(page.locator('.visit-table tbody tr')).toHaveCount(1);
  await page.getByLabel('开始日期').fill('2026-11-20');
  await page.getByLabel('结束日期').fill('2026-11-26');
  await page.getByRole('combobox', {name: '访问设备', exact: true}).selectOption('mobile');
  await page.getByLabel('IP / 访客编号').fill(' 198.51.100 ');
  await page.getByRole('button', {name: '查询', exact: true}).click();
  await expect.poll(() => queries.length).toBe(2);
  expect(Object.fromEntries(queries[1])).toEqual({dateFrom: '2026-11-20', dateTo: '2026-11-26', deviceType: 'mobile', keyword: '198.51.100', page: '1', pageSize: '20'});
  // Editing a field does not silently change an already applied page query.
  await page.getByLabel('IP / 访客编号').fill('draft');
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.locator('.visit-pagination')).toContainText('第 2 / 2 页');
  expect(queries[2].get('keyword')).toBe('198.51.100');
  expect(queries[2].get('page')).toBe('2');
  await expect(page.locator('.visit-table')).toContainText('visitor-desktop-002');
  await page.getByRole('combobox', {name: '每页', exact: true}).selectOption('50');
  await expect.poll(() => queries.length).toBe(4);
  expect(queries[3].get('page')).toBe('1');
  expect(queries[3].get('pageSize')).toBe('50');
  await page.getByRole('button', {name: '重置', exact: true}).click();
  await expect.poll(() => queries.length).toBe(5);
  expect(queries[4].get('dateFrom')).toBe('2026-11-26');
  expect(queries[4].has('deviceType')).toBe(false);
  expect(queries[4].has('keyword')).toBe(false);
});

test('无效日期范围不请求接口，接口失败可以重试并显示空记录', async ({page}) => {
  let requests = 0;
  await mockAdmin(page, async route => {
    requests++;
    if (requests === 1) await route.fulfill({status: 503, json: {message: '访问记录暂时不可用'}});
    else await route.fulfill({json: response([])});
  });
  await page.goto('/#visits');
  await expect(page.getByRole('alert')).toContainText('访问记录暂时不可用');
  await page.getByRole('button', {name: '重新加载'}).click();
  await expect(page.getByRole('heading', {name: '暂无访问记录'})).toBeVisible();
  await page.getByLabel('开始日期').fill('2026-11-27');
  await page.getByLabel('结束日期').fill('2026-11-26');
  await page.getByRole('button', {name: '查询', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('开始日期不能晚于结束日期');
  await page.getByLabel('开始日期').fill('2026-01-01');
  await page.getByRole('button', {name: '查询', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('每次最多查询 90 天');
  expect(requests).toBe(2);
});

test('手机访问明细使用卡片，长 IP 与浏览器标识不撑出页面', async ({page}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockAdmin(page, async route => {await route.fulfill({json: response([mobileVisit, desktopVisit])});});
  await page.goto('/#visits');
  await expect(page.locator('.visit-cards .visit-card')).toHaveCount(2);
  await expect(page.locator('.visit-table-wrap')).toBeHidden();
  await expect(page.locator('.visit-cards')).toContainText('198.51.100.42');
  await page.locator('.visit-card').first().getByText('来源与浏览器标识').click();
  await expect(page.locator('.visit-card').first()).toContainText('Mozilla/5.0');
  const width = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, viewport: window.innerWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({path: testInfo.outputPath('visit-details-mobile.png'), fullPage: true});
});

test('概览明确访问去重口径并可进入访问明细', async ({page}) => {
  await mockAdmin(page, async route => {await route.fulfill({json: response()});});
  await page.goto('/#overview');
  await expect(page.locator('.stats-grid').first()).toContainText('同一浏览器访客每天计 1 次');
  await expect(page.locator('.dashboard-visit-note')).toContainText('相同 IP 的不同访客分别计数');
  await page.getByRole('button', {name: '查看访问明细', exact: true}).click();
  await expect(page).toHaveURL(/#visits$/);
  await expect(page.locator('.visit-table tbody tr')).toHaveCount(3);
});

test('刷新后失效页码自动回退，跨日重置使用当前北京时间', async ({page}) => {
  const queries: URLSearchParams[] = [];
  await mockAdmin(page, async (route, url) => {
    queries.push(url.searchParams);
    const currentPage = Number(url.searchParams.get('page'));
    const total = queries.length < 3 ? 21 : 1;
    const items = total === 1 && currentPage > 1 ? [] : [currentPage === 2 ? desktopVisit : mobileVisit];
    await route.fulfill({json: response(items, currentPage, total)});
  });
  await page.goto('/#visits');
  await expect(page.locator('.visit-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.locator('.visit-pagination')).toContainText('第 2 / 2 页');
  await page.getByRole('button', {name: '刷新明细', exact: true}).click();
  await expect(page.locator('.visit-pagination')).toContainText('第 1 / 1 页');
  expect(queries.map(query => query.get('page'))).toEqual(['1', '2', '2', '1']);
  await expect(page.locator('.visit-table')).toContainText('visitor-mobile-001');
  await expect(page.getByRole('button', {name: '下一页', exact: true})).toBeDisabled();
  await page.clock.setFixedTime(new Date('2026-11-26T16:00:01.000Z'));
  await page.getByRole('button', {name: '重置', exact: true}).click();
  await expect.poll(() => queries.at(-1)?.get('dateFrom')).toBe('2026-11-27');
  await expect(page.getByLabel('结束日期')).toHaveValue('2026-11-27');
});
