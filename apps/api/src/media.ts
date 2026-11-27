import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { CapacityGate } from './capacity.js';

const execute=promisify(execFile);
export const maximumUploadBytes=25*1024*1024;
const processing=new CapacityGate(2,2);
export const minimumUploadFreeBytes=1024n*1024n*1024n;
type StorageStats={bavail:bigint;bsize:bigint};

export async function assertUploadStorage(directory:string,incomingBytes:number,readStats:(directory:string)=>Promise<StorageStats>=directory=>statfs(directory,{bigint:true})) {
  let stats:StorageStats;
  try{stats=await readStats(directory);}
  catch{throw new ServiceUnavailableException('暂时无法检查存储空间，请稍后重试');}
  if(stats.bavail*stats.bsize<minimumUploadFreeBytes+BigInt(incomingBytes)){
    throw new ServiceUnavailableException('存储空间不足，暂时无法上传文件，请联系管理员');
  }
}

export async function decodeUpload(buffer:Buffer,originalName:string) {
  const release=processing.acquire([]);
  if(!release)throw new ServiceUnavailableException('媒体处理任务较多，请稍后重试');
  try{return await decodeMediaUpload(buffer,originalName);}
  finally{release();}
}

async function decodeMediaUpload(buffer:Buffer,originalName:string) {
  if(!buffer?.length||buffer.length>maximumUploadBytes)throw new BadRequestException('文件大小上限为 25 MB');
  let kind:Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {kind=await fileTypeFromBuffer(buffer);} catch {throw new BadRequestException('文件格式无效');}
  if(kind&&['image/jpeg','image/png','image/webp','image/avif','image/tiff'].includes(kind.mime)) {
    if(buffer.length>5*1024*1024)throw new BadRequestException('图片大小上限为 5 MB');
    try {
      const image=sharp(buffer,{limitInputPixels:30_000_000,failOn:'error'});
      const metadata=await image.metadata();
      if(!metadata.width||!metadata.height||!['jpeg','png','webp','avif','tiff'].includes(metadata.format||''))throw new Error('unsupported');
      const data=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
      return {data,type:'image' as const,extension:'webp'};
    } catch {throw new BadRequestException('图片解码失败，请换一张有效图片');}
  }
  const extension=extname(originalName).toLowerCase();
  if(!kind||!((kind.mime==='video/mp4'&&extension==='.mp4')||(kind.mime==='video/webm'&&extension==='.webm')))throw new BadRequestException('仅支持 JPG、PNG、WebP、AVIF 图片和 MP4、WebM 视频');
  const taskDirectory=await mkdtemp(join(tmpdir(),'yp666-media-'));
  try {
    const path=join(taskDirectory,'input'+extension);
    await writeFile(path,buffer,{mode:0o600});
    let result:{stdout:string};
    try {
      result=await execute(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-read_intervals','%+3','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,nb_read_frames:format=format_name,duration','-of','json',path],{timeout:15000,maxBuffer:128*1024,windowsHide:true});
    } catch(error) {
      if((error as NodeJS.ErrnoException).code==='ENOENT')throw new ServiceUnavailableException('视频处理服务尚未配置');
      throw new BadRequestException('视频无法解码，请使用有效的 MP4 或 WebM 文件');
    }
    let metadata:{streams?:{codec_type?:string;codec_name?:string;width?:number;height?:number;nb_read_frames?:string}[];format?:{format_name?:string;duration?:string}};
    try {metadata=JSON.parse(result.stdout);} catch {throw new BadRequestException('视频格式无效');}
    const video=metadata.streams?.find(stream=>stream.codec_type==='video');
    if(!video?.width||!video.height||video.width>7680||video.height>4320||!metadata.format?.format_name||!Number.isFinite(Number(video.nb_read_frames))||Number(video.nb_read_frames)<1)throw new BadRequestException('视频内容无效或分辨率过高');
    if(extension==='.mp4'&&!['h264','hevc','av1','vp9'].includes(video.codec_name||''))throw new BadRequestException('MP4 视频编码不受支持，请使用 H.264 编码');
    if(extension==='.webm'&&!['vp8','vp9','av1'].includes(video.codec_name||''))throw new BadRequestException('WebM 视频编码不受支持');
    return {data:await readFile(path),type:'video' as const,extension:extension.slice(1)};
  } finally {await rm(taskDirectory,{recursive:true,force:true});}
}
