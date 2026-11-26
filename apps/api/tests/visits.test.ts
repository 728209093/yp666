import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../src/app.service.js';
import type { DatabaseService } from '../src/database.service.js';
import { classifyUserAgent, normalizeVisitIp, parseVisitQuery, sanitizeReferrer, visitMetadata, type VisitMetadata } from '../src/visits.js';
import { defaultDocument } from '@yp666/shared';
import { hashToken } from '../src/security.js';
import 'reflect-metadata';
import { AdminController, AdminGuard } from '../src/app.controller.js';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import type { ExecutionContext } from '@nestjs/common';

const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const mobileUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const metadata: VisitMetadata = {ipAddress:'203.0.113.10',deviceType:'desktop',browser:'Edge 130.0.0.0',os:'Windows',userAgent:desktopUa,referrer:'https://source.example/article'};

test('visit metadata distinguishes mobile, tablet, desktop and unknown clients', () => {
  assert.deepEqual(classifyUserAgent(desktopUa), {deviceType:'desktop',browser:'Edge 130.0.0.0',os:'Windows'});
  assert.deepEqual(classifyUserAgent(mobileUa), {deviceType:'mobile',browser:'Safari 18.1',os:'iOS 18.1'});
  assert.equal(classifyUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120.0 Mobile Safari/537.36').deviceType,'mobile');
  assert.equal(classifyUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120.0 Safari/537.36').deviceType,'tablet');
  assert.equal(classifyUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1').deviceType,'tablet');
  assert.equal(classifyUserAgent(`${mobileUa} MicroMessenger/8.0.50`).browser,'WeChat 8.0.50');
  assert.equal(classifyUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)').deviceType,'unknown');
  assert.deepEqual(classifyUserAgent(null),{deviceType:'unknown',browser:null,os:null});
});

test('visit IP uses Express trusted request.ip and normalizes mapped IPv4', () => {
  assert.equal(normalizeVisitIp('::ffff:203.0.113.8'),'203.0.113.8');
  assert.equal(normalizeVisitIp('2001:DB8::1'),'2001:db8::1');
  assert.equal(normalizeVisitIp('203.0.113.8, 198.51.100.3'),null);
  assert.equal(normalizeVisitIp('not-an-ip'),null);
  const headers:Record<string,string> = {'user-agent':desktopUa,'referer':'https://source.example/read?q=secret#token','x-forwarded-for':'198.51.100.99'};
  const result=visitMetadata({ip:'::ffff:127.0.0.1',get:(name:string)=>headers[name]} as Parameters<typeof visitMetadata>[0]);
  assert.equal(result.ipAddress,'127.0.0.1');
  assert.equal(result.referrer,'https://source.example/read');
  assert.equal(result.deviceType,'desktop');
});

test('stored referrers drop credentials, queries, fragments and unsafe URLs', () => {
  assert.equal(sanitizeReferrer('https://name:password@example.com/page?token=secret#private'),'https://example.com/page');
  assert.equal(sanitizeReferrer('javascript:alert(1)'),null);
  assert.equal(sanitizeReferrer('/local/path'),null);
  assert.equal(sanitizeReferrer(undefined),null);
  assert.equal(sanitizeReferrer(`https://example.com/${'x'.repeat(1200)}`)?.length,1000);
});

test('visit filters validate actual calendar dates, bounded ranges and pagination', t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-26T01:00:00Z')});
  assert.deepEqual(parseVisitQuery({}),{dateFrom:'2026-11-26',dateTo:'2026-11-26',page:1,pageSize:20});
  assert.equal(parseVisitQuery({dateFrom:'2026-11-25'}).dateTo,'2026-11-25');
  assert.equal(parseVisitQuery({dateTo:'2026-11-24'}).dateFrom,'2026-11-24');
  assert.equal(parseVisitQuery({dateFrom:'2024-02-29',page:'2',pageSize:'50',keyword:' 203.0.113.1 ',deviceType:'mobile'}).keyword,'203.0.113.1');
  for (const query of [
    {dateFrom:'2026-02-29'},{dateFrom:'2026-11-31'},{dateFrom:'26-11-26'},
    {dateFrom:'2026-11-26',dateTo:'2026-11-25'},
    {dateFrom:'2026-01-01',dateTo:'2026-04-01'},
    {page:'0'},{page:'1.5'},{pageSize:'101'},{deviceType:'phone'},{keyword:'x'.repeat(81)},
    {dateFrom:['2026-11-26']},
  ]) assert.throws(()=>parseVisitQuery(query));
  assert.doesNotThrow(()=>parseVisitQuery({dateFrom:'2026-01-01',dateTo:'2026-03-31'}));
});

type StoredVisit={id:string;visitorId:string;date:string;verified:boolean;createdAt:Date;lastSeenAt:Date}&VisitMetadata;
function visitStore() {
  const rows=new Map<string,StoredVisit>();
  const upsert=async ({where,create,update}: {where:{visitorId_date:{visitorId:string;date:string}};create:StoredVisit;update:Partial<StoredVisit>})=>{
    const key=`${where.visitorId_date.visitorId}:${where.visitorId_date.date}`;
    const previous=rows.get(key);
    const row=previous?{...previous,...update}:{id:`row-${rows.size+1}`,ipAddress:null,deviceType:'unknown',browser:null,os:null,userAgent:null,referrer:null,...create};
    rows.set(key,row);
    return row;
  };
  const db={visit:{upsert},visitor:{update:async()=>({})},$transaction:async(input:Promise<unknown>[]|((tx:unknown)=>Promise<unknown>),_options?:{maxWait:number;timeout:number})=>typeof input==='function'?input(db):Promise.all(input)};
  return {rows,db,service:new AppService(db as unknown as DatabaseService)};
}

test('repeat visits keep one daily row, first time and verified status while updating last access', async t => {
  const initial=new Date('2026-11-26T01:00:00Z');
  t.mock.timers.enable({apis:['Date'],now:initial});
  const {service,rows}=visitStore();
  await service.saveVisit('visitor-one',false,metadata);
  t.mock.timers.tick(60000);
  await service.saveVisit('visitor-one',true,metadata);
  t.mock.timers.tick(60000);
  await service.saveVisit('visitor-one',false,{...metadata,ipAddress:'203.0.113.20'});
  assert.equal(rows.size,1);
  const row=rows.get('visitor-one:2026-11-26')!;
  assert.equal(row.createdAt.getTime(),initial.getTime());
  assert.equal(row.lastSeenAt.getTime(),initial.getTime()+120000);
  assert.equal(row.verified,true);
  assert.equal(row.ipAddress,'203.0.113.20');
});

test('daily UV changes at Shanghai midnight and different browsers sharing an IP remain distinct', async t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-26T15:59:59Z')});
  const {service,rows}=visitStore();
  await service.saveVisit('visitor-one',false,metadata);
  await service.saveVisit('visitor-two',false,metadata);
  assert.equal(rows.size,2);
  t.mock.timers.tick(1000);
  await service.saveVisit('visitor-one',false,metadata);
  assert.equal(rows.size,3);
  assert.equal(rows.has('visitor-one:2026-11-27'),true);
});

test('concurrent first daily visits retry their unique-key collision without adding a row', async () => {
  const {service,rows,db}=visitStore();
  const upsert=db.visit.upsert;
  let attempts=0;
  db.visit.upsert=async input=>{
    attempts++;
    if(attempts===1) {
      // The other request wins the INSERT before this request retries its upsert.
      await upsert(input);
      throw {code:'P2002',meta:{modelName:'Visit',target:['visitorId','date']}};
    }
    return upsert(input);
  };
  await service.saveVisit('visitor-one',false,metadata);
  assert.equal(attempts,2);
  assert.equal(rows.size,1);
});

test('visit retry is bounded and does not hide unrelated database failures', async () => {
  for(const failure of [
    {code:'P2002',meta:{modelName:'Visit',target:'Visit_visitorId_date_key'}},
    {code:'P2002',meta:{modelName:'Visitor',target:['tokenHash']}},
    {code:'P1001'},
    {code:'P2028',meta:{error:'Unable to start a transaction in the given time.'}},
  ]) {
    const {service,db}=visitStore();
    let attempts=0;
    db.visit.upsert=async()=>{attempts++;throw failure;};
    await assert.rejects(()=>service.saveVisit('visitor-one',false,metadata),error=>error===failure);
    assert.equal(attempts,failure.meta?.modelName==='Visit'?2:1);
  }
});

test('Prisma MariaDB adapter unique violations retry only the daily visit index',async()=>{
  for(const [kind,index,expected] of [
    ['UniqueConstraintViolation','Visit_visitorId_date_key',2],
    ['UniqueConstraintViolation','PRIMARY',1],
    ['UniqueConstraintViolation','Visitor_tokenHash_key',1],
    ['ForeignKeyConstraintViolation','Visit_visitorId_date_key',1],
  ] as const) {
    const {service,db}=visitStore();
    const driverAdapterError=Object.assign(new Error(kind),{cause:{kind,constraint:{index}}});
    const failure={code:'P2002',meta:{modelName:'Visit',driverAdapterError}};
    let attempts=0;
    db.visit.upsert=async()=>{attempts++;throw failure;};
    await assert.rejects(()=>service.saveVisit('visitor-one',false,metadata),error=>error===failure);
    assert.equal(attempts,expected);
  }
});

test('daily visits acquire the visitor lock before the visit and allow queued transactions time to start',async()=>{
  const {service,db}=visitStore();
  const calls:string[]=[];
  const upsert=db.visit.upsert;
  db.visitor.update=async()=>{calls.push('visitor');return {};};
  db.visit.upsert=async input=>{calls.push('visit');return upsert(input);};
  const transaction=db.$transaction;
  db.$transaction=async(input,options)=>{
    assert.equal(typeof input,'function','operations must await the parent lock inside the transaction');
    assert.deepEqual(options,{maxWait:15000,timeout:15000});
    return transaction(input,options);
  };
  await service.saveVisit('visitor-one',false,metadata);
  assert.deepEqual(calls,['visitor','visit']);
});

test('visit write conflicts retry the complete transaction with a bounded attempt count',async()=>{
  for(const fails of [2,3]) {
    const {service,db,rows}=visitStore();
    const transaction=db.$transaction;
    let attempts=0;
    db.$transaction=async(input,options)=>{
      attempts++;
      if(attempts<=fails)throw {code:'P2034'};
      return transaction(input,options);
    };
    if(fails===2) {
      await service.saveVisit('visitor-one',false,metadata);
      assert.equal(rows.size,1);
    } else {
      await assert.rejects(()=>service.saveVisit('visitor-one',false,metadata),error=>(error as {code?:string}).code==='P2034');
      assert.equal(rows.size,0);
    }
    assert.equal(attempts,3);
  }
});

test('slider verification upgrades the existing daily visit without overwriting collected metadata', async t => {
  const now=new Date('2026-11-26T01:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const {service,rows,db}=visitStore();
  await service.saveVisit('visitor-one',false,metadata);
  Object.assign(db,{
    challenge:{findFirst:async()=>({targetX:120,createdAt:new Date(now.getTime()-1000),expiresAt:new Date(now.getTime()+10000),attempts:0,consumed:false}),updateMany:async()=>({count:1})},
    site:{findUnique:async()=>({draft:defaultDocument,published:defaultDocument})},
  });
  t.mock.timers.tick(500);
  await service.verifySlider('visitor-one','challenge',120,500,{...metadata,referrer:null});
  const row=rows.get('visitor-one:2026-11-26')!;
  assert.equal(rows.size,1);
  assert.equal(row.verified,true);
  assert.equal(row.referrer,metadata.referrer);
  assert.equal(row.ipAddress,metadata.ipAddress);
  assert.equal(row.createdAt.getTime(),now.getTime());
  assert.equal(row.lastSeenAt.getTime(),now.getTime()+500);
});

test('slider verification uses the same parent-first lock order and retries only its rolled-back transaction',async t=>{
  const now=new Date('2026-11-26T01:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const {service,db,rows}=visitStore();
  const calls:string[]=[];
  let claims=0;
  Object.assign(db,{
    challenge:{findFirst:async()=>({targetX:120,createdAt:new Date(now.getTime()-1000),expiresAt:new Date(now.getTime()+10000),attempts:0,consumed:false}),updateMany:async()=>{claims++;return {count:1};}},
    site:{findUnique:async()=>({draft:defaultDocument,published:defaultDocument})},
  });
  const upsert=db.visit.upsert;
  db.visitor.update=async()=>{calls.push('visitor');return {};};
  let conflict=true;
  db.visit.upsert=async input=>{
    calls.push('visit');
    if(conflict){conflict=false;throw {code:'P2034'};}
    return upsert(input);
  };
  await service.verifySlider('visitor-one','challenge',120,500,metadata);
  assert.deepEqual(calls,['visitor','visit','visitor','visit']);
  assert.equal(claims,1,'do not consume the one-use challenge again when retrying the rolled-back visit write');
  assert.equal(rows.size,1);
  assert.equal([...rows.values()][0].verified,true);
});

test('visitor cookies resolve the same visitor and only token hashes reach the database', async () => {
  const token='x'.repeat(43);
  let lookup:unknown;
  const record={id:'visitor-one',tokenHash:hashToken(token)};
  const db={visitor:{findUnique:async(input:unknown)=>{lookup=input;return record;},create:async()=>assert.fail('existing visitor must not be recreated')}};
  const service=new AppService(db as unknown as DatabaseService);
  assert.equal(await service.getVisitor(token),record);
  assert.deepEqual(lookup,{where:{tokenHash:hashToken(token)}});
});

test('visit list applies all filters and stable pagination without exposing visitor cookie hashes',async()=>{
  let countInput:unknown,findInput:unknown;
  const stored:StoredVisit={id:'visit-one',visitorId:'visitor-one',date:'2026-11-26',verified:true,createdAt:new Date('2026-11-26T01:00:00Z'),lastSeenAt:new Date('2026-11-26T02:00:00Z'),...metadata};
  const db={visit:{count:async(input:unknown)=>{countInput=input;return 31;},findMany:async(input:unknown)=>{findInput=input;return [stored];}},$transaction:(queries:Promise<unknown>[])=>Promise.all(queries)};
  const service=new AppService(db as unknown as DatabaseService);
  const result=await service.listVisits(parseVisitQuery({dateFrom:'2026-11-25',dateTo:'2026-11-26',deviceType:'desktop',keyword:'203.0.113',page:'2',pageSize:'20'}));
  const where={date:{gte:'2026-11-25',lte:'2026-11-26'},deviceType:'desktop',OR:[{ipAddress:{contains:'203.0.113'}},{visitorId:{contains:'203.0.113'}}]};
  assert.deepEqual(countInput,{where});
  assert.deepEqual(findInput,{where,orderBy:[{lastSeenAt:'desc'},{id:'desc'}],skip:20,take:20});
  assert.equal(result.total,31);
  assert.equal(result.totalPages,2);
  assert.equal(result.items[0]?.firstSeenAt,'2026-11-26T01:00:00.000Z');
  assert.equal(result.items[0]?.lastSeenAt,'2026-11-26T02:00:00.000Z');
  assert.equal('tokenHash' in result.items[0]!,false);
});

test('visitor details endpoint requires an authenticated administrator',async()=>{
  assert.ok(Reflect.getMetadata(GUARDS_METADATA,AdminController).includes(AdminGuard));
  const request:{cookies:Record<string,string>;adminSession?:unknown}={cookies:{yp666_admin:'invalid'}};
  const context={switchToHttp:()=>({getRequest:()=>request})} as unknown as ExecutionContext;
  const denied=new AdminGuard({adminFromToken:async()=>null} as unknown as AppService);
  await assert.rejects(()=>denied.canActivate(context),{status:401});
  const session={admin:{id:'admin-one'}};
  const allowed=new AdminGuard({adminFromToken:async()=>session} as unknown as AppService);
  assert.equal(await allowed.canActivate(context),true);
  assert.equal(request.adminSession,session);
});
