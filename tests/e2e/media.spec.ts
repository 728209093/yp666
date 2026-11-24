import { test, expect } from '@playwright/test';
import { apiUrl, cleanupVisitor, database, loginAdmin, targetFor } from './helpers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type mysql from 'mysql2/promise';

test('媒体消息验证上传归属、富文本净化及独立图片回复', async ({playwright}, info) => {
  test.skip(info.project.name !== 'desktop');
  const visitor=await playwright.request.newContext();
  const stranger=await playwright.request.newContext();
  const admin=await playwright.request.newContext();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRzEAAAAASUVORK5CYII=','base64');
  const imageFile={name:'message.png',mimeType:'image/png',buffer:png};
  try {
    expect((await visitor.post(`${apiUrl}/visitor/uploads`,{multipart:{file:imageFile}})).status()).toBe(403);
    await visitor.get(`${apiUrl}/public/bootstrap`);
    const challenge=await (await visitor.get(`${apiUrl}/verification/challenge`)).json();
    const target=await targetFor(challenge.id);
    await new Promise(resolve=>setTimeout(resolve,400));
    expect((await visitor.post(`${apiUrl}/verification/verify`,{data:{challengeId:challenge.id,position:target,elapsedMs:1000}})).ok()).toBeTruthy();
    const upload=await visitor.post(`${apiUrl}/visitor/uploads`,{multipart:{file:imageFile}});
    expect(upload.ok(),await upload.text()).toBeTruthy();
    const media=await upload.json();
    expect(media.type).toBe('image');
    const sent=await visitor.post(`${apiUrl}/visitor/messages`,{data:{type:'image',mediaUrl:media.url}});
    expect(sent.ok(),await sent.text()).toBeTruthy();
    expect((await sent.json()).some((m:{type:string;mediaUrl:string})=>m.type==='image'&&m.mediaUrl===media.url)).toBeTruthy();
    expect((await visitor.post(`${apiUrl}/visitor/messages`,{data:{type:'richtext',content:'<b>不允许</b>'}})).status()).toBe(400);
    expect((await visitor.post(`${apiUrl}/visitor/messages`,{data:{type:'image',mediaUrl:'https://invalid.example/a.png'}})).status()).toBe(400);
    await stranger.get(`${apiUrl}/public/bootstrap`);
    const other=await (await stranger.get(`${apiUrl}/verification/challenge`)).json();
    const otherTarget=await targetFor(other.id);
    await new Promise(resolve=>setTimeout(resolve,400));
    expect((await stranger.post(`${apiUrl}/verification/verify`,{data:{challengeId:other.id,position:otherTarget,elapsedMs:1000}})).ok()).toBeTruthy();
    expect((await stranger.post(`${apiUrl}/visitor/messages`,{data:{type:'image',mediaUrl:media.url}})).status()).toBe(403);
    await loginAdmin(admin);
    const state=await visitor.storageState();
    const cookie=state.cookies.find(c=>c.name==='yp666_visitor')!;
    const db=await database();
    let id:string;
    try {const [rows]=await db.execute<mysql.RowDataPacket[]>('SELECT c.id FROM Conversation c JOIN Visitor v ON c.visitorId=v.id WHERE v.tokenHash=?',[createHash('sha256').update(cookie.value).digest('hex')]);id=rows[0]!.id;}
    finally {await db.end();}
    const rich=await admin.post(`${apiUrl}/admin/conversations/${id}/messages`,{data:{type:'richtext',content:'<p><span style="color:#e53935;background-image:url(javascript:alert(1))">红色回复</span><strong>加粗</strong><script>alert(1)</script><img src=x onerror=alert(1)></p>'}});
    expect(rich.ok(),await rich.text()).toBeTruthy();
    const reply=(await rich.json()).at(-1);
    expect(reply.type).toBe('richtext');
    expect(reply.content).toContain('color:#e53935');
    expect(reply.content).toContain('<strong>');
    expect(reply.content).not.toMatch(/script|onerror|<img|background-image|javascript:/i);
    const adminUpload=await admin.post(`${apiUrl}/admin/uploads`,{multipart:{file:imageFile}});
    expect(adminUpload.ok(),await adminUpload.text()).toBeTruthy();
    const adminMedia=await adminUpload.json();
    expect((await admin.post(`${apiUrl}/admin/conversations/${id}/messages`,{data:{type:'image',mediaUrl:adminMedia.url}})).ok()).toBeTruthy();
    const bad=await visitor.post(`${apiUrl}/visitor/uploads`,{multipart:{file:{name:'fake.mp4',mimeType:'video/mp4',buffer:Buffer.from('<html>fake video</html>')}}});
    expect(bad.status()).toBe(400);
    if(process.env.E2E_VIDEO_FIXTURE) {
      const video=await visitor.post(`${apiUrl}/visitor/uploads`,{multipart:{file:{name:'clip.webm',mimeType:'video/webm',buffer:readFileSync(process.env.E2E_VIDEO_FIXTURE)}}});
      expect(video.ok(),await video.text()).toBeTruthy();
      const data=await video.json();
      expect(data.type).toBe('video');
      expect((await visitor.post(`${apiUrl}/visitor/messages`,{data:{type:'video',mediaUrl:data.url}})).ok()).toBeTruthy();
      const videoResponse=await visitor.get(`${new URL(apiUrl).origin}${data.url}`,{headers:{Range:'bytes=0-99'}});
      expect(videoResponse.status()).toBe(206);
      expect(videoResponse.headers()['content-type']).toContain('video/webm');
    }
  } finally {
    await cleanupVisitor({cookies:async()=>(await visitor.storageState()).cookies});
    await cleanupVisitor({cookies:async()=>(await stranger.storageState()).cookies});
    await admin.post(`${apiUrl}/admin/auth/logout`);
    await visitor.dispose();await stranger.dispose();await admin.dispose();
  }
});
