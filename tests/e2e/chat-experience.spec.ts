import {test, expect} from '@playwright/test';
import {adminUrl,apiUrl,cleanupVisitor,loginAdmin,solve} from './helpers';
import {readFileSync} from 'node:fs';

test('聊天升级：验证弹窗、动态设置、表情、媒体、富文本和回复提醒',async({page,context,playwright},info)=>{
  test.setTimeout(300000);
  page.setDefaultTimeout(30000);
  const admin=await playwright.request.newContext();
  await loginAdmin(admin);
  const original=await (await admin.get(`${apiUrl}/admin/content`)).json();
  const draft=structuredClone(original.published);
  Object.assign(draft.settings,{pageTitle:'在线咨询验收',loadingText:'正在加载，请稍候…',announcement:'滚动公告验收：欢迎咨询，客服会及时回复。',announcementSpeed:18,avatarShape:'square',verificationBackgroundUrl:'/assets/gate-landscape.svg',chatBackgroundUrl:'/assets/landscape.svg'});
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    expect((await admin.put(`${apiUrl}/admin/content`,{data:{document:draft}})).ok()).toBeTruthy();
    expect((await admin.post(`${apiUrl}/admin/content/publish`)).ok()).toBeTruthy();
    const challengeResponse=page.waitForResponse(r=>r.url().endsWith('/api/verification/challenge')&&r.ok());
    await page.goto('/');
    await expect(page.locator('.loading-screen')).toBeVisible();
    const loadingStyle=await page.locator('.loading-screen>p').evaluate(e=>({color:getComputedStyle(e).color,size:parseFloat(getComputedStyle(e).fontSize)}));
    expect(loadingStyle.size).toBeGreaterThanOrEqual(24);
    const channels=loadingStyle.color.match(/\d+/g)!.map(Number);
    expect(channels[0]).toBeGreaterThan(180);
    expect(channels[0]! - channels[1]!).toBeGreaterThan(100);
    expect(channels[0]! - channels[2]!).toBeGreaterThan(100);
    const challenge=await (await challengeResponse).json();
    await expect(page.getByRole('dialog',{name:'安全验证'})).toBeVisible();
    expect(await page.locator('.verification-screen').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('gate-landscape.svg');
    await solve(page,challenge.id);
    await expect(page).toHaveTitle('在线咨询验收');
    await expect(page.locator('.chat-header')).toHaveCount(0);
    await expect(page.locator('.composer-area')).not.toContainText('请勿');
    expect(await page.locator('.chat-room').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('landscape.svg');
    expect(await page.locator('.announcement-track').evaluate(e=>getComputedStyle(e).animationName)).toBe('announcement-scroll');
    const avatar=page.locator('.message-avatar').first();
    expect(await avatar.evaluate(e=>getComputedStyle(e).borderRadius)).toBe('0px');
    await page.getByRole('button',{name:'选择表情',exact:true}).click();
    await page.locator('.emoji-grid button').first().click();
    const composer=page.getByRole('textbox',{name:'咨询消息'});
    expect((await composer.inputValue()).length).toBeGreaterThan(0);
    const note=`聊天验收 ${info.project.name} ${Date.now()}`;
    await composer.fill((await composer.inputValue())+' '+note);
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await expect(page.getByText(note,{exact:false}).first()).toBeVisible({timeout:30000});
    await page.getByRole('button',{name:'发送图片或视频'}).click();
    await expect(page.locator('.attachment-panel').getByRole('button',{name:'发送图片',exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'发送视频',exact:false})).toBeVisible();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRzEAAAAASUVORK5CYII=','base64');
    await page.getByLabel('上传聊天图片').setInputFiles({name:'visitor-image.png',mimeType:'image/png',buffer:png});
    await expect(page.locator('.message-image-button')).toHaveCount(1,{timeout:30000});
    await page.locator('.message-image-button').click();
    await expect(page.getByRole('dialog',{name:'图片大图预览'})).toBeVisible();
    await page.getByRole('button',{name:'关闭大图'}).click();
    if(process.env.E2E_VIDEO_FIXTURE){
      await page.getByLabel('上传聊天视频').setInputFiles({name:'recording.webm',mimeType:'video/webm',buffer:readFileSync(process.env.E2E_VIDEO_FIXTURE)});
      await expect(page.locator('.message-video')).toHaveCount(1,{timeout:30000});
      await expect.poll(()=>page.locator('.message-video').evaluate(e=>(e as HTMLVideoElement).readyState),{timeout:15000}).toBeGreaterThan(0);
    }
    const rows=await (await admin.get(`${apiUrl}/admin/conversations`)).json();
    const conversation=rows.find((r:{lastMessage:string})=>r.lastMessage==='[视频]'||r.lastMessage==='[图片]'||r.lastMessage.includes(note));
    expect(conversation).toBeTruthy();
    const reply=`红色客服回复 ${Date.now()}`;
    expect((await admin.post(`${apiUrl}/admin/conversations/${conversation.id}/messages`,{data:{type:'richtext',content:`<p><span style="color:#e53935">${reply}</span><strong>重点</strong></p>`}})).ok()).toBeTruthy();
    await expect(page.locator('.rich-message').getByText(reply,{exact:true})).toBeVisible({timeout:20000});
    expect(await page.locator('.rich-message').getByText(reply,{exact:true}).evaluate(e=>getComputedStyle(e).color)).toBe('rgb(229, 57, 53)');
    await expect(page.locator('.reply-toast')).toBeVisible();
    const adminUpload=await admin.post(`${apiUrl}/admin/uploads`,{multipart:{file:{name:'admin-only.png',mimeType:'image/png',buffer:png}}});
    expect(adminUpload.ok(),await adminUpload.text()).toBeTruthy();
    const media=await adminUpload.json();
    expect((await admin.post(`${apiUrl}/admin/conversations/${conversation.id}/messages`,{data:{type:'image',mediaUrl:media.url}})).ok()).toBeTruthy();
    await expect(page.locator('.message-image-button')).toHaveCount(2,{timeout:20000});
    if(info.project.name==='desktop'){
      Object.assign(draft.settings,{pageTitle:'动态标题已同步',avatarShape:'circle',chatBackgroundUrl:'/assets/gate-landscape.svg',announcement:'动态滚动公告已更新'});
      await admin.put(`${apiUrl}/admin/content`,{data:{document:draft}});await admin.post(`${apiUrl}/admin/content/publish`);
      await expect(page).toHaveTitle('动态标题已同步',{timeout:22000});
      await expect.poll(()=>avatar.evaluate(e=>getComputedStyle(e).borderRadius)).toBe('50%');
      expect(await page.locator('.chat-room').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('gate-landscape.svg');
      await expect(page.locator('.announcement-track').getByText('动态滚动公告已更新').first()).toBeAttached();
    }
    expect(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`test-results/chat-v2-${info.project.name}.png`,fullPage:true});
    await page.reload();
    await expect(composer).toBeVisible({timeout:30000});
    await expect(page.locator('.message-image-button')).toHaveCount(2);
    expect(errors).toEqual([]);

    const adminPage=await context.newPage();
    await adminPage.goto(adminUrl);
    await adminPage.getByLabel('管理员账号').fill(process.env.ADMIN_USERNAME!);
    await adminPage.getByLabel('登录密码',{exact:true}).fill(process.env.ADMIN_PASSWORD!);
    await adminPage.getByRole('button',{name:'进入工作台'}).click();
    await expect(adminPage.locator('.dashboard-page')).toBeVisible();
    if(info.project.name==='mobile')await adminPage.getByRole('button',{name:'展开菜单'}).click();
    await adminPage.getByRole('button',{name:'页面设置',exact:true}).click();
    await expect(adminPage.getByLabel('浏览器标签页标题',{exact:true})).toBeVisible();
    await expect(adminPage.getByLabel('验证页面背景图片，留空使用默认背景')).toBeAttached();
    expect(await adminPage.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBeTruthy();
    await adminPage.screenshot({path:`test-results/admin-v2-settings-${info.project.name}.png`,fullPage:true});
    await adminPage.close();
  } finally {
    await admin.put(`${apiUrl}/admin/content`,{data:{document:original.published}});
    await admin.post(`${apiUrl}/admin/content/publish`);
    await admin.put(`${apiUrl}/admin/content`,{data:{document:original.draft}});
    await cleanupVisitor(context);
    await admin.post(`${apiUrl}/admin/auth/logout`);await admin.dispose();
  }
});
