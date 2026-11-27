import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultDocument} from '@yp666/shared';
import {normalizeSiteDocument} from '../src/site-content.js';
import {cleanRichText} from '../src/chat-content.js';
import {AppService} from '../src/app.service.js';
import type {DatabaseService} from '../src/database.service.js';

test('legacy content remains literal and new document formatting is explicitly marked', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  delete source.blocks[0].contentFormat;
  delete source.blocks[0].videoUrl;
  source.blocks[0].content = '<b>历史文本不是 HTML</b>';
  const normalized = normalizeSiteDocument(source);
  assert.equal(normalized.blocks[0]!.contentFormat, 'plain');
  assert.equal(normalized.blocks[0]!.videoUrl, '');
  assert.equal(normalized.blocks[0]!.content, '<b>历史文本不是 HTML</b>');
});

test('published rich documents retain allowed size, font, color and emphasis while stripping active HTML', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  source.blocks[0].contentFormat = 'richtext';
  source.blocks[0].content = '<p style="text-align:center"><span style="font-size:24px;font-family:Georgia;color:#e60000;background-image:url(javascript:alert(1))"><b>标题</b></span><span style="font-size:200px;font-family:evil">过大字号</span><script>alert(1)</script><iframe src="https://evil.example"></iframe></p>';
  const html = normalizeSiteDocument(source).blocks[0]!.content;
  assert.match(html, /font-size:24px/);
  assert.match(html, /font-family:Georgia/);
  assert.match(html, /color:#e60000/);
  assert.match(html, /text-align:center/);
  assert.match(html, /<b>标题<\/b>/);
  assert.doesNotMatch(html, /200px|font-family:evil|background-image|javascript:|<script|<iframe/);
  assert.match(cleanRichText('<font size="5" face="Arial" color="#ff0000">文字</font>'), /font-size:24px/);
  assert.match(cleanRichText('<font face="Georgia" style="font-size:24px"><b style="color:rgb(230, 0, 0)">编辑器输出</b></font>'), /font-size:24px/);
  assert.doesNotMatch(cleanRichText('<font face="evil" style="font-size:99px;background-image:url(https://evil.example/x)">unsafe</font>'), /evil|99px|background-image/);
});

test('video content blocks keep safe video URLs and reject script URLs', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  source.blocks[0].type = 'video';
  source.blocks[0].videoUrl = '/uploads/12345678-1234-1234-1234-123456789012.mp4';
  assert.equal(normalizeSiteDocument(source).blocks[0]!.videoUrl, source.blocks[0].videoUrl);
  source.blocks[0].videoUrl = 'javascript:alert(1)';
  assert.throws(() => normalizeSiteDocument(source));
});

test('plain content keeps its length limit while rich documents may include formatting markup', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  source.blocks[0].content = 'a'.repeat(4001);
  assert.throws(() => normalizeSiteDocument(source));
  source.blocks[0].contentFormat = 'richtext';
  assert.doesNotThrow(() => normalizeSiteDocument(source));
});

test('legacy site settings receive appearance defaults without changing existing content', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  delete source.settings.serviceNameFontSize;
  delete source.settings.faviconUrl;
  source.settings.brandName = '现有客服';
  const normalized = normalizeSiteDocument(source);
  assert.equal(normalized.settings.serviceNameFontSize, 14);
  assert.equal(normalized.settings.faviconUrl, '');
  assert.equal(normalized.settings.brandName, '现有客服');
  assert.deepEqual(normalized.blocks, source.blocks);
  assert.deepEqual(normalized.faqs, source.faqs);
});

test('customer service name size accepts only integers from 12 to 18 pixels', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  for (const size of [12, 14, 18]) {
    source.settings.serviceNameFontSize = size;
    assert.equal(normalizeSiteDocument(source).settings.serviceNameFontSize, size);
  }
  for (const size of [11, 19, 14.5, '16', null]) {
    source.settings.serviceNameFontSize = size;
    assert.throws(() => normalizeSiteDocument(source));
  }
});

test('favicon settings retain safe image resource URLs and reject executable or local protocols', () => {
  const source = JSON.parse(JSON.stringify(defaultDocument));
  for (const url of ['', '/uploads/site-icon.webp', '/assets/site-icon.svg', 'https://cdn.example/icon.png', 'http://cdn.example/icon.png']) {
    source.settings.faviconUrl = url;
    assert.equal(normalizeSiteDocument(source).settings.faviconUrl, url);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/icon.png', '//example.com/icon.png']) {
    source.settings.faviconUrl = url;
    assert.throws(() => normalizeSiteDocument(source));
  }
});

test('bootstrap exposes published favicon and bounded name size before visitor verification', async () => {
  const document = structuredClone(defaultDocument);
  document.settings.serviceNameFontSize = 16;
  document.settings.faviconUrl = '/uploads/published-site-icon.webp';
  const service = new AppService({} as DatabaseService);
  const result = await service.bootstrap({id: 'test-visitor', verifiedUntil: null}, document);
  assert.equal(result.verificationRequired, true);
  assert.equal(result.site.serviceNameFontSize, 16);
  assert.equal(result.site.faviconUrl, '/uploads/published-site-icon.webp');
});
