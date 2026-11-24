import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const configUrl=pathToFileURL(resolve('src/config.ts')).href;
function productionStartup(provider:string) {
  return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`const {validateStartup,captchaProvider}=await import(${JSON.stringify(configUrl)});validateStartup();console.log(captchaProvider);`],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,NODE_ENV:'production',CAPTCHA_PROVIDER:provider,ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD:'test-password-for-startup',APP_ORIGINS:'https://site.example',TURNSTILE_SITE_KEY:'',TURNSTILE_SECRET_KEY:''},
  });
}

test('production requires explicit self-hosted slider or configured Turnstile',()=>{
  const slider=productionStartup('slider');
  assert.equal(slider.status,0,slider.stderr);
  assert.equal(slider.stdout.trim(),'slider');
  assert.notEqual(productionStartup('local').status,0);
  assert.notEqual(productionStartup('turnstile').status,0);
  assert.notEqual(productionStartup('typo').status,0);
});
