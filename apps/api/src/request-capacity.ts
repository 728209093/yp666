import { HttpException, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { finalize } from 'rxjs';
import { CapacityGate } from './capacity.js';
import { adminCookie, hashToken, visitorCookie } from './security.js';

const uploads=new CapacityGate(4,2);
const authentication=new CapacityGate(3,2);

function protect(context:ExecutionContext,next:CallHandler,gate:CapacityGate,includeOwner:boolean) {
  const http=context.switchToHttp();
  const request=http.getRequest<Request>();
  const response=http.getResponse<Response>();
  const keys=[`ip:${request.ip||request.socket.remoteAddress||'unknown'}`];
  if(includeOwner){
    const token=request.cookies?.[/^\/(?:api\/)?admin\//i.test(request.path)?adminCookie:visitorCookie];
    if(typeof token==='string'&&/^[\w-]{43}$/.test(token))keys.push(`owner:${hashToken(token)}`);
  }
  const release=gate.acquire(keys);
  if(!release){
    response.setHeader('Retry-After','2');
    throw new HttpException(includeOwner?'上传任务较多，请稍后重试':'登录操作较多，请稍后重试',429);
  }
  try{return next.handle().pipe(finalize(release));}
  catch(error){release();throw error;}
}

@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler){return protect(context,next,uploads,true);}
}

@Injectable()
export class AuthCapacityInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext,next:CallHandler){return protect(context,next,authentication,false);}
}
