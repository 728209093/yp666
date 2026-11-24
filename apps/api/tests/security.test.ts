import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeIsValid, hashToken, newToken, originAllowed, shanghaiDate, WindowLimiter } from '../src/security.js';
import { siteDocumentSchema, defaultDocument } from '@yp666/shared';

test('slider accepts close drag only while server-bound challenge remains active',()=>{
  const now=Date.now();
  const challenge={targetX:147,createdAt:new Date(now-1500),expiresAt:new Date(now+2000),consumed:false,attempts:0};
  assert.equal(challengeIsValid({position:150,elapsedMs:1300},challenge,now),true);
  assert.equal(challengeIsValid({position:147,elapsedMs:100},challenge,now),false);
  assert.equal(challengeIsValid({position:147,elapsedMs:1300},{...challenge,createdAt:new Date(now-100)},now),false);
  assert.equal(challengeIsValid({position:147,elapsedMs:1300},{...challenge,consumed:true},now),false);
  assert.equal(challengeIsValid({position:147,elapsedMs:1300},{...challenge,attempts:3},now),false);
  assert.equal(challengeIsValid({position:147,elapsedMs:1300},{...challenge,expiresAt:new Date(now-1)},now),false);
  assert.equal(challengeIsValid({position:NaN,elapsedMs:1300},challenge,now),false);
  assert.equal(challengeIsValid({position:147+6,elapsedMs:1300},challenge,now),false);
});

test('remote session tokens are opaque and only hashes are persisted',()=>{
  const first=newToken(),second=newToken();
  assert.notEqual(first,second);
  assert.equal(first.length,43);
  assert.equal(hashToken(first).length,64);
  assert.notEqual(hashToken(first),first);
});

test('cross-site mutations are denied while known local apps are accepted',()=>{
  assert.equal(originAllowed('http://127.0.0.1:5173'),true);
  assert.equal(originAllowed('https://attacker.example'),false);
  assert.equal(originAllowed(undefined,'cross-site'),false);
  assert.equal(originAllowed(undefined,'same-origin'),true);
});

test('validation rejects script links and permits uploaded images',()=>{
  const unsafe=structuredClone(defaultDocument);unsafe.blocks[0]!.url='javascript:alert(1)';
  assert.equal(siteDocumentSchema.safeParse(unsafe).success,false);
  const safe=structuredClone(defaultDocument);safe.settings.avatarUrl='/uploads/9a1.webp';
  assert.equal(siteDocumentSchema.safeParse(safe).success,true);
});

test('content limits reject oversized visitor-facing payloads',()=>{
  const oversized=structuredClone(defaultDocument);
  oversized.settings.announcement='a'.repeat(241);
  assert.equal(siteDocumentSchema.safeParse(oversized).success,false);
  const invalidTtl=structuredClone(defaultDocument);
  invalidTtl.settings.verificationTtlMinutes=0;
  assert.equal(siteDocumentSchema.safeParse(invalidTtl).success,false);
});

test('rate limits reset after window and separate unrelated sessions',()=>{
  const limit=new WindowLimiter();
  assert.equal(limit.take('one',2,1000,10),true);
  assert.equal(limit.take('one',2,1000,11),true);
  assert.equal(limit.take('one',2,1000,12),false);
  assert.equal(limit.take('other',2,1000,12),true);
  assert.equal(limit.take('one',2,1000,1011),true);
});

test('dashboard day boundaries follow Asia Shanghai',()=>{
  assert.equal(shanghaiDate(new Date('2026-11-24T16:01:00Z')),'2026-11-25');
  assert.equal(shanghaiDate(new Date('2026-11-24T15:59:00Z')),'2026-11-24');
});
