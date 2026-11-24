import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRichText, messageSchema, normalizeMessage, richTextPlain } from '../src/chat-content.js';
import { AppService } from '../src/app.service.js';
import type { DatabaseService } from '../src/database.service.js';

test('rich replies preserve supported formatting while removing executable HTML and unsafe URLs',()=>{
  const safe=cleanRichText('<p onclick="alert(1)"><span style="color:#e60000;background-image:url(javascript:alert(1))">红字</span><b>粗体</b><font color="#00aabb">蓝字</font><a href="javascript:alert(1)">坏链接</a><a href="https://example.com" onclick="evil()">链接</a><img src=x onerror=evil()><script>alert(1)</script><iframe src=x></iframe></p>');
  assert.match(safe,/color:#e60000/);
  assert.match(safe,/<b>粗体<\/b>/);
  assert.match(safe,/color:#00aabb/);
  assert.match(safe,/href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(safe,/onclick|javascript:|background-image|<script|<iframe|<img|onerror/);
  assert.equal(richTextPlain('<p>你好 <b>世界</b></p>'),'你好 世界');
});

test('visitor text remains literal and visitor rich HTML is refused',()=>{
  const text=normalizeMessage(messageSchema.parse({content:'<b>你好</b> 😀'}),false);
  assert.equal(text.type,'text');
  assert.equal(text.content,'<b>你好</b> 😀');
  assert.throws(()=>normalizeMessage(messageSchema.parse({type:'richtext',content:'<b>你好</b>'}),false));
  assert.throws(()=>normalizeMessage(messageSchema.parse({type:'richtext',content:'<script>bad()</script>'}),true));
  assert.throws(()=>normalizeMessage(messageSchema.parse({type:'image',mediaUrl:'https://evil.example/file.jpg'}),false));
});

test('uploaded media is bound to its uploader and persisted filename cannot be forged',async()=>{
  let query:Record<string,unknown>|undefined;
  const db={mediaUpload:{findFirst:async({where}:{where:Record<string,unknown>})=>{query=where;return where.visitorId==='owner'?{type:'image',fileName:'stored.webp'}:null;}}};
  const service=new AppService(db as unknown as DatabaseService);
  const inspect=service as unknown as {messageData:(input:ReturnType<typeof messageSchema.parse>,owner:{visitorId:string})=>Promise<{fileName:string}>};
  const input=messageSchema.parse({type:'image',mediaUrl:'/uploads/12345678-1234-1234-1234-123456789012.webp',fileName:'forged.html'});
  const result=await inspect.messageData(input,{visitorId:'owner'});
  assert.equal(result.fileName,'stored.webp');
  assert.equal(query?.visitorId,'owner');
  await assert.rejects(()=>inspect.messageData(input,{visitorId:'other'}));
});
