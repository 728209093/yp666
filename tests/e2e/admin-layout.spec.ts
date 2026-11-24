import { test, expect } from '@playwright/test';
import './helpers';

test('后台响应式布局与草稿保存发布操作', async ({page}, info) => {
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5174');
  await page.getByLabel('管理员账号').fill(process.env.ADMIN_USERNAME!);
  await page.getByLabel('登录密码',{exact:true}).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button',{name:'进入工作台'}).click();
  await expect(page.locator('.dashboard-page')).toBeVisible();
  await expect(page.locator('.dashboard-page .el-loading-mask')).toHaveCount(0,{timeout:20000});
  expect(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/admin-dashboard-${info.project.name}.png`,fullPage:true});
  if(info.project.name==='mobile')await page.getByRole('button',{name:'展开菜单'}).click();
  await page.getByRole('button',{name:'页面设置',exact:true}).click();
  const brand=page.getByLabel('品牌名称',{exact:true});
  await expect(brand).toHaveValue('青屿');
  if(info.project.name==='desktop'){
    const intro=page.getByLabel('介绍区标题',{exact:true});
    const original=await intro.inputValue();
    try{
      await intro.fill('本地编辑发布验收');
      await page.getByRole('button',{name:'保存草稿',exact:true}).click();
      await expect(page.getByText('草稿已保存，等待发布',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'发布到前台',exact:true}).click();
      await page.getByRole('button',{name:'确认发布',exact:true}).click();
      await expect(page.getByText('当前内容已发布',{exact:true})).toBeVisible();
    }finally{
      await intro.fill(original);
      await page.getByRole('button',{name:'发布到前台',exact:true}).click();
      await page.getByRole('button',{name:'确认发布',exact:true}).click();
      await expect(page.getByText('当前内容已发布',{exact:true})).toBeVisible();
    }
  }
  expect(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/admin-settings-${info.project.name}.png`,fullPage:true});
  expect(errors).toEqual([]);
  if(info.project.name==='mobile')await page.getByRole('button',{name:'展开菜单'}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'进入工作台'})).toBeVisible();
});
