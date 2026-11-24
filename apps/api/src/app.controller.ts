import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Post, Put, Param, Req, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppService } from './app.service.js';
import { DatabaseService } from './database.service.js';
import { adminCookie, cookieOptions, parse, visitorCookie } from './security.js';
import { captchaProvider } from './config.js';

const loginSchema=z.object({username:z.string().trim().min(1).max(64),password:z.string().min(1).max(128)});
const messageSchema=z.object({content:z.string().trim().min(1,'请输入消息内容').max(4000,'消息最多 4000 个字符')});
const passwordSchema=z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(12,'新密码至少 12 位').max(128)});
const verifySchema=z.object({challengeId:z.string().max(128).optional(),position:z.number().finite().min(0).max(320).optional(),elapsedMs:z.number().finite().min(0).max(600000).optional(),token:z.string().min(1).max(4096).optional()});

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly app:AppService) {}
  async canActivate(context:ExecutionContext) {
    const req=context.switchToHttp().getRequest<Request>();
    const session=await this.app.adminFromToken(req.cookies?.[adminCookie]);
    if(!session)throw new UnauthorizedException('请先登录管理后台');
    Object.assign(req,{adminSession:session});
    return true;
  }
}

async function visitor(app:AppService,request:Request,response:Response) {
  const record=await app.getVisitor(request.cookies?.[visitorCookie]);
  if(!record)throw new UnauthorizedException('访问会话无效');
  if('generatedToken' in record)response.cookie(visitorCookie,record.generatedToken,cookieOptions(30*24*60*60_000));
  return record;
}

@Controller()
export class PublicController {
  constructor(private readonly app:AppService,private readonly db:DatabaseService) {}

  @Get('health')
  async health() {await this.db.$queryRaw`SELECT 1`;return {status:'ok',database:'connected'};}

  @Get('public/bootstrap')
  async bootstrap(@Req()request:Request,@Res({passthrough:true})response:Response) {
    const record=await visitor(this.app,request,response);
    const {published}=await this.app.site();
    const result=await this.app.bootstrap(record,published);
    await this.app.saveVisit(record.id,result.verified);
    return result;
  }

  @Get('verification/challenge')
  async challenge(@Req()request:Request,@Res({passthrough:true})response:Response) {
    const record=await visitor(this.app,request,response);
    return this.app.createChallenge(record.id);
  }

  @Post('verification/verify')
  @HttpCode(200)
  async verify(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:Response) {
    const input=parse(verifySchema,body);
    const record=await visitor(this.app,request,response);
    let expiresAt:Date;
    if(captchaProvider==='turnstile') {
      if(!input.token)throw new BadRequestException('缺少验证结果');
      expiresAt=await this.app.verifyTurnstile(record.id,input.token,request.ip);
    } else {
      if(!input.challengeId||input.position===undefined||input.elapsedMs===undefined)throw new BadRequestException('缺少拼图验证结果');
      expiresAt=await this.app.verifySlider(record.id,input.challengeId,input.position,input.elapsedMs);
    }
    return {verified:true,expiresAt:expiresAt.toISOString()};
  }

  @Get('public/content')
  async content(@Req()request:Request,@Res({passthrough:true})response:Response) {
    const record=await visitor(this.app,request,response);
    const {published}=await this.app.site();
    await this.app.assertVerified(record.id,published);
    return published;
  }

  @Get('visitor/messages')
  async messages(@Req()request:Request,@Res({passthrough:true})response:Response) {
    const record=await visitor(this.app,request,response);
    const {published}=await this.app.site();
    await this.app.assertVerified(record.id,published);
    return this.app.messages(record.id);
  }

  @Post('visitor/messages')
  @HttpCode(200)
  async send(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:Response) {
    const {content}=parse(messageSchema,body);
    const record=await visitor(this.app,request,response);
    const {published}=await this.app.site();
    await this.app.assertVerified(record.id,published);
    return this.app.sendVisitor(record.id,content);
  }
}

@Controller('admin/auth')
export class AuthController {
  constructor(private readonly app:AppService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body()body:unknown,@Res({passthrough:true})response:Response) {
    const input=parse(loginSchema,body);
    const result=await this.app.login(input.username,input.password);
    response.cookie(adminCookie,result.token,cookieOptions(12*60*60_000));
    return {username:result.username};
  }

  @Get('me')
  async me(@Req()request:Request) {
    const result=await this.app.adminFromToken(request.cookies?.[adminCookie]);
    if(!result)throw new UnauthorizedException('请先登录管理后台');
    return {username:result.admin.username};
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req()request:Request,@Res({passthrough:true})response:Response) {
    await this.app.logout(request.cookies?.[adminCookie]);
    response.clearCookie(adminCookie,cookieOptions(0));
    return {ok:true};
  }

  @Post('password')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async password(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:Response) {
    const input=parse(passwordSchema,body);
    const result=await this.app.adminFromToken(request.cookies?.[adminCookie]);
    if(!result)throw new UnauthorizedException('请先登录管理后台');
    await this.app.changePassword(result.admin.id,input.currentPassword,input.newPassword);
    response.clearCookie(adminCookie,cookieOptions(0));
    return {ok:true};
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly app:AppService) {}

  @Get('dashboard') dashboard() {return this.app.dashboard();}
  @Get('content') content() {return this.app.adminContent();}
  @Put('content')
  save(@Body()body:{document?:unknown}) {
    if(!body||typeof body!=='object'||!('document' in body))throw new BadRequestException('缺少网站内容');
    return this.app.saveDraft(body.document);
  }
  @Post('content/publish')
  @HttpCode(200)
  publish() {return this.app.publishDraft();}
  @Get('conversations') conversations() {return this.app.listConversations();}
  @Get('conversations/:id') conversation(@Param('id')id:string) {return this.app.adminConversation(id);}
  @Post('conversations/:id/messages')
  @HttpCode(200)
  reply(@Param('id')id:string,@Body()body:unknown) {const input=parse(messageSchema,body);return this.app.reply(id,input.content);}
  @Post('uploads')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1}}))
  upload(@UploadedFile()file:Express.Multer.File|undefined) {
    if(!file)throw new BadRequestException('请选择图片文件');
    return this.app.upload(file.buffer,file.originalname);
  }
}
