import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import {type CallHandler,type ExecutionContext,HttpException} from '@nestjs/common';
import {INTERCEPTORS_METADATA} from '@nestjs/common/constants.js';
import {lastValueFrom,of,Subject,throwError} from 'rxjs';
import type {Request,Response} from 'express';
import {CapacityGate} from '../src/capacity.js';
import {AuthCapacityInterceptor,UploadCapacityInterceptor} from '../src/request-capacity.js';
import {AdminController,AuthController,PublicController} from '../src/app.controller.js';
import {requestRatePolicy,securityMiddleware,WindowLimiter} from '../src/security.js';
import {assertUploadStorage,minimumUploadFreeBytes} from '../src/media.js';

test('rate-limit storage stays bounded without resetting another active client limit',()=>{
  const limiter=new WindowLimiter(2);
  assert.equal(limiter.take('first',1,1000,0),true);
  assert.equal(limiter.take('second',1,1000,1),true);
  assert.equal(limiter.take('new-address',1,1000,2),false);
  assert.equal(limiter.take('first',1,1000,3),false);
  assert.equal(limiter.take('new-address',1,1000,1001),true);
  assert.equal(limiter.take('first',1,1000,1002),true);
});

test('password changes use their own strict window and Express case/trailing-slash variants cannot bypass it',()=>{
  const policy=requestRatePolicy('POST','/admin/auth/password');
  assert.deepEqual(policy,{category:'password',limit:5,milliseconds:900000});
  assert.deepEqual(requestRatePolicy('POST','/ADMIN/AUTH/PASSWORD/'),policy);
  assert.equal(requestRatePolicy('POST','/admin/auth/login/').category,'login');
  assert.equal(requestRatePolicy('POST','/visitor/messages/').category,'send');
  assert.equal(requestRatePolicy('GET','/visitor/messages').category,'all');
});

test('middleware rejects repeated password requests before expensive handlers and disables caching even on denial',()=>{
  const middleware=securityMiddleware();
  const request={method:'POST',path:'/ADMIN/AUTH/PASSWORD/',ip:'203.0.113.8',socket:{},get:()=>undefined} as unknown as Request;
  let calls=0;
  const responses=Array.from({length:6},()=>{
    const headers:Record<string,string>={};
    let status=200;
    const response={setHeader:(name:string,value:string)=>{headers[name]=value;},status:(value:number)=>{status=value;return response;},json:()=>response} as unknown as Response;
    middleware(request,response,()=>{calls++;});
    return {headers,status};
  });
  assert.equal(calls,5);
  assert.equal(responses[5].status,429);
  assert.equal(responses[5].headers['Retry-After'],'900');
  assert.equal(responses[5].headers['Cache-Control'],'no-store');
});

test('capacity rejects excess work without a queue and releases slots exactly once',()=>{
  const gate=new CapacityGate(2,1);
  const first=gate.acquire(['one']);assert.ok(first);
  assert.equal(gate.acquire(['one']),null);
  const second=gate.acquire(['two']);assert.ok(second);
  assert.equal(gate.acquire(['three']),null);
  first();first();
  const third=gate.acquire(['three']);assert.ok(third);
  assert.equal(gate.acquire(['four']),null);
  second();third();
  const last=gate.acquire(['one']);assert.ok(last);last();
});

test('uploads reserve disk headroom and storage failures never expose filesystem paths',async()=>{
  const bytes=25*1024*1024;
  const privatePath='/private/server/upload-directory';
  await assertUploadStorage(privatePath,bytes,async()=>({bavail:minimumUploadFreeBytes+BigInt(bytes),bsize:1n}));
  await assert.rejects(()=>assertUploadStorage(privatePath,bytes,async()=>({bavail:minimumUploadFreeBytes+BigInt(bytes)-1n,bsize:1n})),error=>{
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(),503);
    assert.match(error.message,/存储空间不足/);
    assert.ok(!error.message.includes(privatePath));
    return true;
  });
  await assert.rejects(()=>assertUploadStorage(privatePath,bytes,async()=>{throw new Error(`statfs failed at ${privatePath}`);}),error=>{
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(),503);
    assert.match(error.message,/无法检查存储空间/);
    assert.ok(!error.message.includes(privatePath));
    return true;
  });
});

function context(ip:string,path='/api/visitor/uploads',cookies:Record<string,string>={}){
  const headers:Record<string,string>={};
  const request={ip,path,cookies,socket:{remoteAddress:ip}} as Request;
  return {headers,value:{switchToHttp:()=>({getRequest:()=>request,getResponse:()=>({setHeader:(name:string,value:string)=>{headers[name]=value;}})})} as unknown as ExecutionContext};
}

test('upload admission caps buffered requests by IP and owner before Multer and releases canceled or failed work',async()=>{
  for(const controller of [PublicController,AdminController]){
    assert.equal(Reflect.getMetadata(INTERCEPTORS_METADATA,controller.prototype.upload)?.[0],UploadCapacityInterceptor);
  }
  const interceptor=new UploadCapacityInterceptor();
  const jobs=[new Subject<boolean>(),new Subject<boolean>()];
  const same=context('203.0.113.9');
  const first=interceptor.intercept(same.value,{handle:()=>jobs[0]} as CallHandler).subscribe();
  const second=interceptor.intercept(same.value,{handle:()=>jobs[1]} as CallHandler).subscribe();
  assert.throws(()=>interceptor.intercept(same.value,{handle:()=>of(true)}),error=>error instanceof HttpException&&error.getStatus()===429);
  assert.equal(same.headers['Retry-After'],'2');
  first.unsubscribe();
  const failure=new Error('decode failed');
  await assert.rejects(lastValueFrom(interceptor.intercept(same.value,{handle:()=>throwError(()=>failure)})),error=>error===failure);
  assert.equal(await lastValueFrom(interceptor.intercept(same.value,{handle:()=>of(true)})),true);
  second.unsubscribe();
  const owner={yp666_admin:'x'.repeat(43)};
  const a=context('203.0.113.10','/api/admin/uploads',owner),b=context('203.0.113.11','/api/admin/uploads',owner),c=context('203.0.113.12','/api/admin/uploads',owner);
  const holds=[new Subject<boolean>(),new Subject<boolean>()];
  const one=interceptor.intercept(a.value,{handle:()=>holds[0]}).subscribe();
  const two=interceptor.intercept(b.value,{handle:()=>holds[1]}).subscribe();
  assert.throws(()=>interceptor.intercept(c.value,{handle:()=>of(true)}),error=>error instanceof HttpException&&error.getStatus()===429);
  one.unsubscribe();two.unsubscribe();
});

test('authentication CPU work is bounded and synchronous handler errors release capacity',async()=>{
  assert.ok(Reflect.getMetadata(INTERCEPTORS_METADATA,AuthController.prototype.login)?.includes(AuthCapacityInterceptor));
  assert.ok(Reflect.getMetadata(INTERCEPTORS_METADATA,AuthController.prototype.password)?.includes(AuthCapacityInterceptor));
  const interceptor=new AuthCapacityInterceptor();
  const same=context('203.0.113.13','/api/admin/auth/login');
  const failure=new Error('handler failed');
  assert.throws(()=>interceptor.intercept(same.value,{handle:()=>{throw failure;}}),error=>error===failure);
  const holds=[new Subject<boolean>(),new Subject<boolean>()];
  const first=interceptor.intercept(same.value,{handle:()=>holds[0]}).subscribe();
  const second=interceptor.intercept(same.value,{handle:()=>holds[1]}).subscribe();
  assert.throws(()=>interceptor.intercept(same.value,{handle:()=>of(true)}),error=>error instanceof HttpException&&error.getStatus()===429);
  first.unsubscribe();second.unsubscribe();
  assert.equal(await lastValueFrom(interceptor.intercept(same.value,{handle:()=>of(true)})),true);
});
