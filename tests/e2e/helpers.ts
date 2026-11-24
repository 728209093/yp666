import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { expect, type Page, type APIRequestContext } from '@playwright/test';

config({ path: process.env.E2E_ENV_FILE || '.env.local', quiet: true });
export const apiUrl = process.env.E2E_API_URL || 'http://127.0.0.1:3001/api';
export const adminUrl = process.env.E2E_ADMIN_URL || 'http://127.0.0.1:5174';
export function database() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    ssl: { ca: readFileSync(resolve(process.env.MYSQL_SSL_CA!)), rejectUnauthorized: true, verifyIdentity: false },
  });
}
export async function targetFor(id: string) {
  const db = await database();
  try {
    const storedId = createHash('sha256').update(id).digest('hex').slice(0, 32);
    const [rows] = await db.execute<mysql.RowDataPacket[]>('SELECT targetX FROM Challenge WHERE id = ?', [storedId]);
    expect(rows).toHaveLength(1);
    return Number(rows[0]!.targetX);
  } finally { await db.end(); }
}
export async function solve(page: Page, id: string) {
  const target = await targetFor(id);
  const handle = page.getByRole('slider');
  await expect(handle).toBeEnabled();
  const box = await handle.boundingBox();
  const track = await page.locator('.slider-track').boundingBox();
  if (!box || !track) throw new Error('Slider is not visible');
  const max = Number(await handle.getAttribute('aria-valuemax'));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + target / max * (track.width - box.width), y, { steps: 18 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: '咨询消息' })).toBeVisible({ timeout: 20000 });
}
export async function loginAdmin(request: APIRequestContext) {
  const response = await request.post(`${apiUrl}/admin/auth/login`, { data: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
  expect(response.ok(), await response.text()).toBeTruthy();
}
export async function cleanupVisitor(context: {cookies(): Promise<{name:string;value:string}[]>}) {
  const cookie = (await context.cookies()).find(x => x.name === 'yp666_visitor');
  if (!cookie) return;
  const db = await database();
  try { await db.execute('DELETE FROM Visitor WHERE tokenHash = ?', [createHash('sha256').update(cookie.value).digest('hex')]); }
  finally { await db.end(); }
}
