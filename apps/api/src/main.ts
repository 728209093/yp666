import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { isProduction, uploadDirectory, validateStartup } from './config.js';
import { securityMiddleware } from './security.js';

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    if(error instanceof HttpException) {
      const body=error.getResponse();
      const message=typeof body==='string'?body:(body as {message?:string|string[]}).message;
      response.status(error.getStatus()).json({message:Array.isArray(message)?message.join('；'):message||'请求未完成'});
    } else {
      Logger.error(error instanceof Error?`${error.name}: ${error.message.replace(/mysql:\/\/[^\s]+/g,'[数据库连接已隐藏]')}`:'Unknown server error','API');
      response.status(500).json({message:'服务暂时不可用，请稍后再试'});
    }
  }
}

async function main() {
  validateStartup();
  await mkdir(uploadDirectory,{recursive:true});
  const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:false});
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'loopback') app.set('trust proxy','loopback');
  app.useBodyParser('json',{limit:'128kb'});
  app.use(cookieParser());
  app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}}));
  app.use('/api',securityMiddleware());
  app.useStaticAssets(uploadDirectory,{prefix:'/uploads/',index:false,dotfiles:'deny',setHeaders:response=>{response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','public, max-age=604800');}});
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port=Number(process.env.API_PORT||process.env.PORT||3001);
  const host=process.env.API_HOST||process.env.HOST||'127.0.0.1';
  await app.listen(port,host);
  Logger.log(`API ready at http://${host}:${port}/api`,'Bootstrap');
}

main().catch(error=>{Logger.error(error instanceof Error?error.message:'API startup failed','Bootstrap');process.exit(1);});
