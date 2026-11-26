import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { AppService } from '../src/app.service.js';
import type { DatabaseService } from '../src/database.service.js';
import { assertNewPassword } from '../src/password.js';

test('new passwords respect bcrypt UTF-8 byte limits for ASCII, Chinese and emoji',()=>{
  for(const password of ['a'.repeat(12),'a'.repeat(72),'密'.repeat(24),'🔐'.repeat(18)]) {
    assert.doesNotThrow(()=>assertNewPassword(password));
  }
  for(const password of ['a'.repeat(11),'a'.repeat(73),'密'.repeat(25),'🔐'.repeat(19)]) {
    assert.throws(()=>assertNewPassword(password),BadRequestException);
  }
});

test('password changes reject differences beyond bcrypt 72-byte prefix without changing storage',async()=>{
  const currentPassword='current-password';
  const passwordHash=await bcrypt.hash(currentPassword,4);
  let transactions=0;
  const db={admin:{findUnique:async()=>({id:'admin-one',passwordHash})},$transaction:async()=>{transactions++;}};
  const service=new AppService(db as unknown as DatabaseService);
  const prefix='a'.repeat(72);
  for(const tail of ['first'.padEnd(56,'x'),'second'.padEnd(56,'x')]) {
    await assert.rejects(service.changePassword('admin-one',currentPassword,prefix+tail),BadRequestException);
  }
  assert.equal(transactions,0);
});

test('existing long-password administrators can still log in',async()=>{
  const legacyPassword='a'.repeat(80);
  const passwordHash=await bcrypt.hash(legacyPassword,4);
  let sessions=0;
  const db={
    admin:{findUnique:async()=>({id:'admin-one',username:'admin',passwordHash})},
    adminSession:{create:async()=>{sessions++;}},
  };
  const result=await new AppService(db as unknown as DatabaseService).login('admin',legacyPassword);
  assert.equal(result.username,'admin');
  assert.equal(sessions,1);
});

test('legacy administrators can change to a 72-byte password and invalidate their sessions',async()=>{
  const currentPassword='a'.repeat(80);
  const passwordHash=await bcrypt.hash(currentPassword,4);
  const newPassword='密'.repeat(24);
  let storedHash='';
  let clearedAdminId='';
  let transactions=0;
  const db={
    admin:{
      findUnique:async()=>({id:'admin-one',passwordHash}),
      update:async({data}:{data:{passwordHash:string}})=>{storedHash=data.passwordHash;},
    },
    adminSession:{deleteMany:async({where}:{where:{adminId:string}})=>{clearedAdminId=where.adminId;}},
    $transaction:async(operations:Promise<unknown>[])=>{transactions++;return Promise.all(operations);},
  };
  await new AppService(db as unknown as DatabaseService).changePassword('admin-one',currentPassword,newPassword);
  assert.notEqual(storedHash,newPassword);
  assert.equal(await bcrypt.compare(newPassword,storedHash),true);
  assert.equal(await bcrypt.compare(currentPassword,storedHash),false);
  assert.equal(clearedAdminId,'admin-one');
  assert.equal(transactions,1);
});

test('bootstrap validates new administrator passwords without blocking existing accounts',async()=>{
  const originalUsername=process.env.ADMIN_USERNAME;
  const originalPassword=process.env.ADMIN_PASSWORD;
  process.env.ADMIN_USERNAME='test-admin';
  process.env.ADMIN_PASSWORD='密'.repeat(25);
  let writes=0;
  const db={
    admin:{findUnique:async()=>null,upsert:async()=>{writes++;}},
    adminSession:{deleteMany:async()=>({count:0})},
    site:{upsert:async()=>({})},
    $queryRaw:async()=>[],
  };
  try {
    await assert.rejects(new AppService(db as unknown as DatabaseService).onApplicationBootstrap(),BadRequestException);
    assert.equal(writes,0);
    const existing={...db,admin:{...db.admin,findUnique:async()=>({id:'existing-admin'})}};
    await assert.doesNotReject(new AppService(existing as unknown as DatabaseService).onApplicationBootstrap());
  } finally {
    if(originalUsername===undefined)delete process.env.ADMIN_USERNAME;else process.env.ADMIN_USERNAME=originalUsername;
    if(originalPassword===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=originalPassword;
  }
});
