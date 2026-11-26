import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { richTextFontSizes } from '@yp666/shared';

export const messageSchema=z.object({
  content:z.string().max(20000,'消息内容过长').optional().default(''),
  type:z.enum(['text','richtext','image','video']).optional().default('text'),
  mediaUrl:z.string().max(255).optional(),
  fileName:z.string().max(160).optional(),
});
export type MessageInput=z.infer<typeof messageSchema>;
const color=/^(?:#[a-f0-9]{3}(?:[a-f0-9]{3})?|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|(?:black|white|red|green|blue|orange|purple|gray|grey|yellow))$/i;
const fontSize=new RegExp(`^(?:${richTextFontSizes.join('|')})px$`);
const fontFamily=/^(?:Arial|Georgia|['"]?Times New Roman['"]?|['"]?Microsoft YaHei['"]?|sans-serif|serif)$/i;
export function cleanRichText(html:string) {
  return sanitizeHtml(html,{
    allowedTags:['p','div','span','br','strong','b','em','i','u','s','ul','ol','li','a','blockquote','code'],
    allowedAttributes:{'*':['style'],a:['href','target','rel']},
    allowedStyles:{'*':{'color':[color],'background-color':[color],'font-size':[fontSize],'font-family':[fontFamily],'text-align':[/^(?:left|center|right)$/]}},
    allowedSchemes:['https','http','mailto'],
    allowProtocolRelative:false,
    transformTags:{
      a:(_tag,attributes)=>({tagName:'a',attribs:{href:attributes.href||'',target:'_blank',rel:'noopener noreferrer'}}),
      font:(_tag,attributes)=>{const styles:string[]=attributes.style?[attributes.style]:[];if(color.test(attributes.color||''))styles.push(`color:${attributes.color}`);if(fontFamily.test(attributes.face||''))styles.push(`font-family:${attributes.face}`);const size=({'1':12,'2':14,'3':16,'4':18,'5':24,'6':32,'7':36} as Record<string,number>)[attributes.size||''];if(size)styles.push(`font-size:${size}px`);const attribs:Record<string,string>={};if(styles.length)attribs.style=styles.join(';');return {tagName:'span',attribs};},
    },
  }).trim();
}
export function richTextPlain(html:string) {return sanitizeHtml(html,{allowedTags:[],allowedAttributes:{}}).replace(/&nbsp;/g,' ').trim();}
export function normalizeMessage(input:MessageInput,admin:boolean) {
  if(input.type==='richtext') {
    if(!admin)throw new BadRequestException('访客消息不支持富文本');
    const content=cleanRichText(input.content);
    if(!richTextPlain(content))throw new BadRequestException('请输入回复内容');
    if(content.length>16000)throw new BadRequestException('富文本消息过长');
    return {type:input.type,content,mediaUrl:null,fileName:null};
  }
  if(input.type==='image'||input.type==='video') {
    if(!input.mediaUrl||!/^\/uploads\/[a-f0-9-]{36}\.(?:webp|mp4|webm)$/.test(input.mediaUrl))throw new BadRequestException('请选择本站上传的图片或视频');
    return {type:input.type,content:input.content.trim().slice(0,4000),mediaUrl:input.mediaUrl,fileName:null};
  }
  const content=input.content.trim();
  if(!content||content.length>4000)throw new BadRequestException('消息长度需要为 1 至 4000 个字符');
  return {type:'text' as const,content,mediaUrl:null,fileName:null};
}
