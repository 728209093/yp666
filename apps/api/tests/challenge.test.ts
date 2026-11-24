import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { AppService } from '../src/app.service.js';
import type { DatabaseService } from '../src/database.service.js';

test('challenge reveals images only while target remains bound to its visitor in storage',async()=>{
  let persisted:Record<string,unknown>|undefined;
  const db={challenge:{deleteMany:async()=>({count:0}),create:async({data}:{data:Record<string,unknown>})=>{persisted=data;return data;}}};
  const service=new AppService(db as unknown as DatabaseService);
  const payload=await service.createChallenge('visitor-one');
  assert.equal(payload.width,320);
  assert.equal(payload.height,180);
  assert.equal(payload.pieceSize,44);
  assert.equal(persisted?.visitorId,'visitor-one');
  assert.equal(typeof persisted?.targetX,'number');
  assert.equal('targetX' in payload,false);
  assert.notEqual(payload.id,persisted?.id);
  const background=await sharp(Buffer.from(payload.background.split(',')[1]!,'base64')).metadata();
  const piece=await sharp(Buffer.from(payload.piece.split(',')[1]!,'base64')).metadata();
  assert.equal(background.width,320);
  assert.equal(background.height,180);
  assert.equal(piece.width,44);
  assert.equal(piece.hasAlpha,true);
});
