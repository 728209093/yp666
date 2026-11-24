import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultDocument, siteDocumentSchema,
  type AdminContentResponse, type BootstrapResponse, type ChatMessage, type ConversationDetail,
  type ConversationSummary, type DashboardStats, type SiteDocument, type SliderChallenge,
} from '@yp666/shared';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { allowedOrigins, captchaProvider, uploadDirectory } from './config.js';
import { challengeIsValid, hashToken, newToken, parse, shanghaiDate } from './security.js';
import { renderSliderPuzzle } from './puzzle.js';
import { normalizeMessage, richTextPlain, type MessageInput } from './chat-content.js';
import { decodeUpload } from './media.js';

const MS_MINUTE=60_000;
const ADMIN_SESSION_HOURS=12;
const IMAGE_WIDTH=320;
const IMAGE_HEIGHT=180;
const PIECE_SIZE=44;
const turnstileUrl='https://challenges.cloudflare.com/turnstile/v0/siteverify';
type StoredMessage={id:string;role:string;content:string;type?:string;mediaUrl?:string|null;fileName?:string|null;createdAt:Date};
const messageShape=(row:StoredMessage): ChatMessage => ({id:row.id,role:row.role as ChatMessage['role'],content:row.content,type:(row.type||'text') as ChatMessage['type'],...(row.mediaUrl?{mediaUrl:row.mediaUrl}:{}),...(row.fileName?{fileName:row.fileName}:{}),createdAt:row.createdAt.toISOString()});
const messagePreview=(message:{type?:string;content:string}|undefined)=>!message?'暂无消息':message.type==='image'?'[图片]':message.type==='video'?'[视频]':message.type==='richtext'?richTextPlain(message.content):message.content;
const summaryShape=(row: {id:string;visitorLabel:string;unreadCount:number;createdAt:Date;updatedAt:Date;messages:{content:string;type?:string}[]}): ConversationSummary => ({id:row.id,visitorLabel:row.visitorLabel,unreadCount:row.unreadCount,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),lastMessage:messagePreview(row.messages[0])});
type UploadOwner={visitorId:string;adminId?:never}|{adminId:string;visitorId?:never};

function clampSite(value: unknown): SiteDocument { return parse(siteDocumentSchema,value); }


@Injectable()
export class AppService implements OnApplicationBootstrap {
  constructor(private readonly db: DatabaseService) {}

  async onApplicationBootstrap() {
    const now=new Date();
    const raw=process.env.ADMIN_USERNAME!.trim();
    if (!raw || raw.length>64) throw new Error('ADMIN_USERNAME 长度需要为 1 至 64 个字符');
    if(!await this.db.admin.findUnique({where:{username:raw}})) {
      const passwordHash=await bcrypt.hash(process.env.ADMIN_PASSWORD!,12);
      await this.db.admin.upsert({where:{username:raw},update:{},create:{username:raw,passwordHash}});
    }
    await this.db.adminSession.deleteMany({where:{expiresAt:{lt:now}}});
    const initial=JSON.parse(JSON.stringify(defaultDocument));
    await this.db.site.upsert({where:{id:1},create:{id:1,draft:initial,published:initial,publishedAt:now},update:{}});
    await this.db.$queryRaw`SELECT 1`;
  }

  async getVisitor(rawToken: string | undefined,create=true) {
    if (rawToken&&rawToken.length===43) {
      const existing=await this.db.visitor.findUnique({where:{tokenHash:hashToken(rawToken)}});
      if (existing) return existing;
    }
    if (!create) return null;
    const token=newToken();
    const visitor=await this.db.visitor.create({data:{tokenHash:hashToken(token),lastSeenAt:new Date()}});
    return {...visitor, generatedToken:token};
  }

  async saveVisit(visitorId:string,verified:boolean) {
    const date=shanghaiDate();
    await this.db.$transaction([
      this.db.visit.upsert({where:{visitorId_date:{visitorId,date}},create:{visitorId,date,verified},update:verified?{verified:true}:{}}),
      this.db.visitor.update({where:{id:visitorId},data:{lastSeenAt:new Date()}}),
    ]);
  }

  async site() {
    let row=await this.db.site.findUnique({where:{id:1}});
    if (!row) {const initial=JSON.parse(JSON.stringify(defaultDocument));row=await this.db.site.create({data:{id:1,draft:initial,published:initial,publishedAt:new Date()}});}
    return {row,draft:clampSite(row.draft),published:clampSite(row.published)};
  }

  async bootstrap(visitor: {id:string;verifiedUntil:Date|null},document:SiteDocument):Promise<BootstrapResponse> {
    const enabled=document.settings.verificationEnabled;
    const verified=Boolean(visitor.verifiedUntil&&visitor.verifiedUntil.getTime()>Date.now());
    return {
      site:{brandName:document.settings.brandName,title:document.settings.title,subtitle:document.settings.subtitle,avatarUrl:document.settings.avatarUrl,primaryColor:document.settings.primaryColor,verificationEnabled:enabled,verificationBackgroundUrl:document.settings.verificationBackgroundUrl,pageTitle:document.settings.pageTitle,loadingText:document.settings.loadingText,avatarShape:document.settings.avatarShape},
      verificationRequired:enabled&&!verified,verified:!enabled||verified,captchaProvider,
      ...(captchaProvider==='turnstile'?{turnstileSiteKey:process.env.TURNSTILE_SITE_KEY}:{}),
    };
  }

  async createChallenge(visitorId:string):Promise<SliderChallenge> {
    if(captchaProvider==='turnstile') throw new BadRequestException('当前站点使用第三方安全验证');
    await this.db.challenge.deleteMany({where:{OR:[{expiresAt:{lt:new Date()}},{visitorId,consumed:true}]}});
    const targetX=randomInt(62,220);
    const pieceY=randomInt(48,112);
    const id=newToken();
    const {background,piece}=await renderSliderPuzzle(targetX,pieceY);
    await this.db.challenge.create({data:{id:hashToken(id).slice(0,32),visitorId,targetX,expiresAt:new Date(Date.now()+2*MS_MINUTE)}});
    return {id,kind:'slider',background:`data:image/png;base64,${background.toString('base64')}`,piece:`data:image/png;base64,${piece.toString('base64')}`,width:IMAGE_WIDTH,height:IMAGE_HEIGHT,pieceSize:PIECE_SIZE,pieceY,expiresAt:new Date(Date.now()+2*MS_MINUTE).toISOString()};
  }

  async verifySlider(visitorId:string,challengeId:string,position:number,elapsedMs:number):Promise<Date> {
    const id=hashToken(challengeId).slice(0,32);
    const challenge=await this.db.challenge.findFirst({where:{id,visitorId}});
    if (!challenge) throw new ForbiddenException('验证已失效，请重新尝试');
    const now=Date.now();
    const good=challengeIsValid({position,elapsedMs},challenge,now);
    const {published}=await this.site();
    const until=new Date(now+published.settings.verificationTtlMinutes*MS_MINUTE);
    const claimed=await this.db.challenge.updateMany({where:{id,visitorId,consumed:false,attempts:challenge.attempts,expiresAt:{gt:new Date(now)}},data:{attempts:{increment:1},consumed:true}});
    if(!claimed.count||!good)throw new ForbiddenException('验证未通过或已经失效，请刷新后重试');
    await this.db.$transaction(async tx=>{
      await tx.visitor.update({where:{id:visitorId},data:{verifiedUntil:until}});
      const date=shanghaiDate(new Date(now));
      await tx.visit.upsert({where:{visitorId_date:{visitorId,date}},create:{visitorId,date,verified:true},update:{verified:true}});
    });
    return until;
  }

  async verifyTurnstile(visitorId:string,token:string,ip:string|undefined) {
    if(captchaProvider!=='turnstile') throw new BadRequestException('当前验证方式不匹配');
    const body=new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY!,response:token,...(ip?{remoteip:ip}:{})});
    let result:{success:boolean;hostname?:string};
    try {
      const response=await fetch(turnstileUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw new Error('siteverify status');
      result=await response.json() as {success:boolean;hostname?:string};
    } catch { throw new ServiceUnavailableException('安全验证服务暂不可用，请稍后再试'); }
    const hostnames=new Set([...allowedOrigins].map(origin=>new URL(origin).hostname));
    if(!result.success||!result.hostname||!hostnames.has(result.hostname))throw new ForbiddenException('验证未通过，请重新尝试');
    const {published}=await this.site();
    const until=new Date(Date.now()+published.settings.verificationTtlMinutes*MS_MINUTE);
    await this.db.visitor.update({where:{id:visitorId},data:{verifiedUntil:until}});
    const date=shanghaiDate();
    await this.db.visit.upsert({where:{visitorId_date:{visitorId,date}},create:{visitorId,date,verified:true},update:{verified:true}});
    return until;
  }

  async assertVerified(visitorId:string,document:SiteDocument) {
    if(!document.settings.verificationEnabled)return;
    const visitor=await this.db.visitor.findUnique({where:{id:visitorId},select:{verifiedUntil:true}});
    if(!visitor?.verifiedUntil||visitor.verifiedUntil.getTime()<=Date.now())throw new ForbiddenException('访问许可已过期，请重新验证');
  }

  async messages(visitorId:string) {
    const conversation=await this.db.conversation.findUnique({where:{visitorId},include:{messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:300}}});
    return conversation?.messages.reverse().map(messageShape)||[];
  }

  private async messageData(input:MessageInput,owner:UploadOwner) {
    const normalized=normalizeMessage(input,!!owner.adminId);
    if(normalized.mediaUrl) {
      const upload=await this.db.mediaUpload.findFirst({where:{url:normalized.mediaUrl,...owner}});
      if(!upload||upload.type!==normalized.type)throw new ForbiddenException('无法发送此文件，请重新上传');
      return {...normalized,fileName:upload.fileName};
    }
    return normalized;
  }

  async sendVisitor(visitorId:string,input:MessageInput) {
    const normalized=await this.messageData(input,{visitorId});
    const {published}=await this.site();
    const faq=normalized.type==='text'?published.faqs.find(item=>item.enabled&&item.question.localeCompare(normalized.content,'zh',{sensitivity:'accent'})===0):undefined;
    const initial=published.settings.welcomeMessage.trim()||'你好，欢迎留言。';
    const conversation=await this.db.conversation.upsert({where:{visitorId},update:{},create:{visitorId,visitorLabel:'访客-'+randomInt(1000,9999),messages:{create:{role:'assistant',content:initial}}}});
    const now=new Date();
    await this.db.$transaction(async tx=>{
      await tx.conversation.update({where:{id:conversation.id},data:{...(faq?{}:{unreadCount:{increment:1}}),updatedAt:now}});
      await tx.message.create({data:{conversationId:conversation.id,role:'visitor',...normalized,createdAt:now}});
      if(faq)await tx.message.create({data:{conversationId:conversation.id,role:'assistant',content:faq.answer,createdAt:new Date(now.getTime()+1)}});
    });
    return this.messages(visitorId);
  }

  async adminContent():Promise<AdminContentResponse> {
    const {row,draft,published}=await this.site();
    return {draft,published,publishedAt:row.publishedAt?.toISOString()||null};
  }

  async saveDraft(document:unknown):Promise<AdminContentResponse> {
    const safe=clampSite(document);
    await this.db.site.upsert({where:{id:1},create:{id:1,draft:safe,published:JSON.parse(JSON.stringify(defaultDocument))},update:{draft:safe}});
    return this.adminContent();
  }

  async publishDraft():Promise<AdminContentResponse> {
    const row=await this.db.site.findUnique({where:{id:1}});
    if(!row)throw new ServiceUnavailableException('请先保存网站设置');
    const draft=clampSite(row.draft);
    await this.db.site.update({where:{id:1},data:{published:draft,publishedAt:new Date()}});
    return this.adminContent();
  }

  async dashboard():Promise<DashboardStats> {
    const today=shanghaiDate();
    const days=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-(6-i));return shanghaiDate(date);});
    const [counts,totalConversations,unreadConversations]=await Promise.all([
      this.db.visit.groupBy({by:['date'],where:{date:{in:days}},_count:{_all:true}}),
      this.db.conversation.count(),this.db.conversation.count({where:{unreadCount:{gt:0}}}),
    ]);
    const verifiedRows=await this.db.visit.groupBy({by:['date','verified'],where:{date:{in:days},verified:true},_count:{_all:true}});
    const totals=new Map(counts.map(item=>[item.date,item._count._all]));
    const verified=new Map(verifiedRows.map(item=>[item.date,(verifiedRows.filter(row=>row.date===item.date).reduce((n,row)=>n+row._count._all,0))]));
    const todayRows=verifiedRows.filter(row=>row.date===today);
    return {visitsToday:totals.get(today)||0,verifiedToday:todayRows.reduce((sum,item)=>sum+item._count._all,0),totalConversations,unreadConversations,recentVisits:days.map(date=>({date,visits:totals.get(date)||0,verified:verified.get(date)||0}))};
  }

  async listConversations():Promise<ConversationSummary[]> {
    const rows=await this.db.conversation.findMany({orderBy:[{unreadCount:'desc'},{updatedAt:'desc'}],take:200,include:{messages:{orderBy:{createdAt:'desc'},take:1,select:{content:true,type:true}}}});
    return rows.map(summaryShape);
  }

  async adminConversation(id:string):Promise<ConversationDetail> {
    const conversation=await this.db.conversation.findUnique({where:{id},include:{messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:500}}});
    if(!conversation)throw new NotFoundException('会话不存在');
    conversation.messages.reverse();
    await this.db.conversation.updateMany({where:{id,unreadCount:conversation.unreadCount},data:{unreadCount:0,updatedAt:conversation.updatedAt}});
    return {conversation:summaryShape({...conversation,unreadCount:0,messages:conversation.messages.slice(-1)}),messages:conversation.messages.map(messageShape)};
  }

  async reply(id:string,input:MessageInput,adminId:string):Promise<ChatMessage[]> {
    const normalized=await this.messageData(input,{adminId});
    const conversation=await this.db.conversation.findUnique({where:{id},select:{id:true}});
    if(!conversation)throw new NotFoundException('会话不存在');
    const now=new Date();
    await this.db.$transaction([
      this.db.message.create({data:{conversationId:id,role:'admin',...normalized,createdAt:now}}),
      this.db.conversation.update({where:{id},data:{unreadCount:0,updatedAt:now}}),
    ]);
    const rows=await this.db.message.findMany({where:{conversationId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:500});
    return rows.reverse().map(messageShape);
  }

  async upload(buffer:Buffer,originalName:string,owner:UploadOwner) {
    const media=await decodeUpload(buffer,originalName);
    await mkdir(uploadDirectory,{recursive:true});
    const filename=`${randomUUID()}.${media.extension}`;
    const url=`/uploads/${filename}`;
    const fileName=originalName.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,160)||filename;
    const path=join(uploadDirectory,filename);
    await writeFile(path,media.data,{flag:'wx',mode:0o640});
    try {await this.db.mediaUpload.create({data:{url,type:media.type,fileName,...owner}});}
    catch(error) {await unlink(path).catch(()=>{});throw error;}
    return {url,type:media.type,fileName};
  }

  async adminFromToken(token:string|undefined) {
    if(!token||!/^[\w-]{40,48}$/.test(token))return null;
    const session=await this.db.adminSession.findUnique({where:{tokenHash:hashToken(token)},include:{admin:true}});
    if(!session||session.expiresAt.getTime()<=Date.now())return null;
    return {session,admin:session.admin};
  }

  async login(username:string,password:string) {
    const admin=await this.db.admin.findUnique({where:{username}});
    if(!admin||!await bcrypt.compare(password,admin.passwordHash))throw new UnauthorizedException('用户名或密码不正确');
    const token=newToken();
    const expiresAt=new Date(Date.now()+ADMIN_SESSION_HOURS*60*60_000);
    await this.db.adminSession.create({data:{adminId:admin.id,tokenHash:hashToken(token),expiresAt}});
    return {token,expiresAt,username:admin.username};
  }

  async logout(rawToken:string|undefined) {
    if(rawToken)await this.db.adminSession.deleteMany({where:{tokenHash:hashToken(rawToken)}});
  }

  async changePassword(adminId:string,currentPassword:string,newPassword:string) {
    const admin=await this.db.admin.findUnique({where:{id:adminId}});
    if(!admin||!await bcrypt.compare(currentPassword,admin.passwordHash))throw new UnauthorizedException('当前密码不正确');
    if(newPassword.length<12||newPassword.length>128)throw new BadRequestException('新密码长度需要为 12 至 128 个字符');
    const passwordHash=await bcrypt.hash(newPassword,12);
    await this.db.$transaction([
      this.db.admin.update({where:{id:adminId},data:{passwordHash}}),
      this.db.adminSession.deleteMany({where:{adminId}}),
    ]);
  }
}

export const turnstileDigest=(token:string)=>createHash('sha256').update(token).digest('hex');
