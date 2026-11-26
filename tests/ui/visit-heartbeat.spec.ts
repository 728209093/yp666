import {test, expect, type Page} from '@playwright/test';
import {defaultDocument} from '../../packages/shared/src/index';

async function mockVisits(page: Page, verified: boolean) {
  await page.clock.install({time: new Date('2026-11-26T15:59:30.000Z')});
  let bootstraps=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/public/bootstrap') {
      bootstraps++;
      await route.fulfill({json:{site:defaultDocument.settings,verificationRequired:!verified,verified,captchaProvider:'local'}});
    } else if(path==='/api/public/content') {
      await route.fulfill({json:{...defaultDocument,settings:{...defaultDocument.settings,verificationEnabled:false}}});
    } else if(path==='/api/visitor/messages') await route.fulfill({json:[]});
    else if(path==='/api/verification/challenge') {
      await route.fulfill({json:{id:'challenge',kind:'slider',background:'',piece:'',width:320,height:180,pieceSize:44,pieceY:80,expiresAt:'2026-11-26T16:10:00.000Z'}});
    } else {
      await route.fulfill({status:500,json:{message:`Unexpected mocked API request: ${path}`}});
      throw new Error(`Unexpected mocked API request: ${path}`);
    }
  });
  await page.goto('http://127.0.0.1:5273');
  await expect.poll(()=>bootstraps).toBe(1);
  await page.clock.runFor(1200);
  await expect(page.locator('.loading-screen')).toBeHidden();
  return ()=>bootstraps;
}

test('聊天页跨北京时间午夜后继续发送可见访问心跳',async({page})=>{
  const bootstraps=await mockVisits(page,true);
  await expect(page.getByRole('textbox',{name:'咨询消息'})).toBeVisible();
  await page.clock.runFor(65000);
  await expect.poll(bootstraps).toBe(2);
  await expect(page.getByRole('textbox',{name:'咨询消息'})).toBeVisible();
});

for(const verified of [true,false]) {
  test(`${verified?'聊天页':'验证页'}在隐藏期间不发送访问心跳，重新显示后补记`,async({page})=>{
    const bootstraps=await mockVisits(page,verified);
    await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));
    await page.clock.runFor(90000);
    expect(bootstraps()).toBe(1);
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(bootstraps).toBe(2);
  });
}
