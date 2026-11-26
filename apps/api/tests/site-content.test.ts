import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultDocument} from '@yp666/shared';
import {normalizeSiteDocument} from '../src/site-content.js';
import {cleanRichText} from '../src/chat-content.js';

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
