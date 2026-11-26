<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {ArrowLeft, ImagePlus, LoaderCircle, MessageCircle, RefreshCw, Search, Send, ShieldCheck, Video, Volume2, VolumeX} from 'lucide-vue-next';
import type {ChatMessage, ConversationDetail, ConversationSummary} from '@yp666/shared';
import {api} from '../api';
import {dateTime} from '../utils';
import {richTextPlain, safeRichText} from '../richtext';
import MediaPreview from './MediaPreview.vue';
import RichTextEditor from './RichTextEditor.vue';

const conversations=ref<ConversationSummary[]>([]);
const selected=ref<ConversationDetail>();
const query=ref('');
const filter=ref<'all'|'unread'>('all');
const loading=ref(true);
const detailLoading=ref(false);
const error=ref('');
const reply=ref('');
const sending=ref(false);
const uploading=ref(false);
const messageList=ref<HTMLElement>();
const mediaInput=ref<HTMLInputElement>();
const mediaKind=ref<'image'|'video'>('image');
const preview=ref('');
const sound=ref(localStorage.getItem('yp666-admin-sound')==='on');
const newNotice=ref('');
const replyPlain=computed(()=>richTextPlain(reply.value));
const filtered=computed(()=>conversations.value.filter(row=>(filter.value!=='unread'||row.unreadCount>0)&&(!query.value.trim()||`${row.visitorLabel} ${row.lastMessage}`.toLowerCase().includes(query.value.trim().toLowerCase()))));
const unread=computed(()=>conversations.value.filter(row=>row.unreadCount>0).length);
let timer:ReturnType<typeof setInterval>|undefined;
let noticeTimer:ReturnType<typeof setTimeout>|undefined;
let loadId=0;
let inFlight=false;
let initialized=false;
let disposed=false;
let context:AudioContext|undefined;

function tone(){
  if(!sound.value)return;
  try{
    context ||= new AudioContext();
    if(context.state!=='running')return;
    const oscillator=context.createOscillator();const gain=context.createGain();
    oscillator.connect(gain);gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(780,context.currentTime);
    oscillator.frequency.setValueAtTime(1040,context.currentTime+.12);
    gain.gain.setValueAtTime(.07,context.currentTime);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+.32);
    oscillator.start();oscillator.stop(context.currentTime+.33);
  }catch{}
}
async function toggleSound(){sound.value=!sound.value;localStorage.setItem('yp666-admin-sound',sound.value?'on':'off');if(sound.value){try{context ||=new AudioContext();await context.resume();tone();}catch{}}}
function unlockSound(){if(sound.value){try{context ||=new AudioContext();void context.resume().catch(()=>{});}catch{}}}
function notify(label:string){newNotice.value=`${label} 发来了新消息`;if(noticeTimer)clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>newNotice.value='',6500);tone();}
async function load(silent=false){
  if(!silent){loading.value=true;error.value='';}
  try{
    const rows=await api<ConversationSummary[]>('/admin/conversations');
    if(disposed)return;
    if(initialized){
      const fresh=rows.find(row=>{const previous=conversations.value.find(v=>v.id===row.id);return row.unreadCount>0&&(!previous||row.unreadCount>previous.unreadCount||row.updatedAt!==previous.updatedAt);});
      if(fresh)notify(fresh.visitorLabel);
    }
    conversations.value=rows;initialized=true;
  }catch(e){if(!silent)error.value=(e as Error).message;}finally{loading.value=false;}
}
async function open(row:ConversationSummary){
  if(sending.value||uploading.value)return;
  const id=++loadId;detailLoading.value=true;reply.value='';
  try{const detail=await api<ConversationDetail>(`/admin/conversations/${encodeURIComponent(row.id)}`);if(id!==loadId)return;selected.value=detail;const found=conversations.value.find(v=>v.id===row.id);if(found)found.unreadCount=0;await scrollBottom();}
  catch(e){ElMessage.error((e as Error).message);}finally{if(id===loadId)detailLoading.value=false;}
}
async function scrollBottom(){await nextTick();if(messageList.value)messageList.value.scrollTop=messageList.value.scrollHeight;}
function mediaLoaded(){if(messageList.value&&messageList.value.scrollHeight-messageList.value.scrollTop-messageList.value.clientHeight<340)void scrollBottom();}
async function poll(){
  if(disposed||inFlight||sending.value||uploading.value||detailLoading.value)return;
  const version=loadId;
  inFlight=true;
  try{
    await load(true);
    if(disposed||version!==loadId||sending.value||uploading.value||detailLoading.value)return;
    const id=selected.value?.conversation.id;if(!id)return;
    if(document.hidden)return;
    const detail=await api<ConversationDetail>(`/admin/conversations/${encodeURIComponent(id)}`);
    if(disposed||version!==loadId||selected.value?.conversation.id!==id)return;
    const previous=selected.value.messages.at(-1)?.id;
    const nearBottom=!messageList.value||messageList.value.scrollHeight-messageList.value.scrollTop-messageList.value.clientHeight<130;
    selected.value=detail;const row=conversations.value.find(v=>v.id===id);if(row)row.unreadCount=0;
    if(previous!==detail.messages.at(-1)?.id&&nearBottom)await scrollBottom();
  }catch{}finally{inFlight=false;}
}
async function send(payload?:{type:'image'|'video';mediaUrl:string;fileName:string}){
  const id=selected.value?.conversation.id;
  if(!id||sending.value||detailLoading.value||(!payload&&(!replyPlain.value||uploading.value)))return;
  if(!payload&&replyPlain.value.length>4000){ElMessage.warning('回复文字最多 4000 个字符');return;}
  // Invalidate detail requests started before this reply, even if they return after it.
  ++loadId;sending.value=true;
  try{
    const body=payload?{...payload,content:''}:{type:'richtext',content:safeRichText(reply.value)};
    const messages=await api<ChatMessage[]>(`/admin/conversations/${encodeURIComponent(id)}/messages`,{method:'POST',body:JSON.stringify(body)});
    if(selected.value?.conversation.id===id){selected.value.messages=messages;if(!payload)reply.value='';await scrollBottom();}
    await load(true);
  }catch(e){ElMessage.error((e as Error).message);}finally{sending.value=false;}
}
async function choose(kind:'image'|'video'){
  mediaKind.value=kind;await nextTick();mediaInput.value?.click();
}
async function upload(event:Event){
  if(sending.value||uploading.value||detailLoading.value)return;
  const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;
  const kind=mediaKind.value;const max=(kind==='image'?5:25)*1024*1024;
  if(file.size>max){ElMessage.warning(kind==='image'?'图片最大 5 MB':'视频最大 25 MB');input.value='';return;}
  if(kind==='image'&&!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)||kind==='video'&&!['video/mp4','video/webm'].includes(file.type)){ElMessage.warning('请选择支持的图片或 MP4 / WebM 视频');input.value='';return;}
  ++loadId;uploading.value=true;
  try{const data=new FormData();data.append('file',file);const result=await api<{url:string;type:'image'|'video';fileName:string}>('/admin/uploads',{method:'POST',body:data});await send({type:result.type,mediaUrl:result.url,fileName:result.fileName});}
  catch(e){ElMessage.error((e as Error).message);}finally{uploading.value=false;input.value='';}
}
function back(){if(sending.value||uploading.value)return;++loadId;selected.value=undefined;reply.value='';detailLoading.value=false;}
function closePreview(event:KeyboardEvent){if(event.key==='Escape')preview.value='';}
onMounted(async()=>{await load();if(disposed)return;timer=setInterval(()=>void poll(),4000);document.addEventListener('keydown',closePreview);document.addEventListener('pointerdown',unlockSound);});
onBeforeUnmount(()=>{disposed=true;++loadId;if(timer)clearInterval(timer);if(noticeTimer)clearTimeout(noticeTimer);document.removeEventListener('keydown',closePreview);document.removeEventListener('pointerdown',unlockSound);void context?.close();});
</script>

<template>
  <section class="conversations-page">
    <div class="page-heading"><div><div class="eyebrow">A THOUGHTFUL REPLY MATTERS</div><h1>每个问题，都有回应<span class="heading-dot">.</span></h1><p>文字、图片与视频，让每一次回应更清楚。</p></div><div class="conversation-heading-actions"><button class="sound-toggle" :class="{active:sound}" :aria-label="sound?'关闭新消息提示音':'开启新消息提示音'" @click="toggleSound"><Volume2 v-if="sound" :size="17"/><VolumeX v-else :size="17"/><span>提示音{{sound?'开':'关'}}</span></button><el-button :loading="loading" @click="load()"><RefreshCw :size="15"/>刷新会话</el-button></div></div>
    <div v-if="newNotice" class="admin-new-message" role="status"><MessageCircle :size="16"/>{{newNotice}}<button @click="newNotice=''">知道了</button></div>
    <div v-if="error" class="error-panel"><p>{{error}}</p><el-button @click="load()">重新加载</el-button></div>
    <div v-else class="conversation-workspace panel" :class="{'has-selected':selected}">
      <aside class="conversation-sidebar" v-loading="loading">
        <div class="conversation-list-title"><h2>访客会话 <span>{{conversations.length}}</span></h2><span v-if="unread" class="unread-label">{{unread}} 待查看</span></div>
        <div class="conversation-search"><Search :size="15"/><input v-model="query" placeholder="搜索访客或留言内容" aria-label="搜索访客或留言内容"/></div>
        <div class="conversation-tabs"><button :class="{active:filter==='all'}" @click="filter='all'">全部会话</button><button :class="{active:filter==='unread'}" @click="filter='unread'">待查看 <span>{{unread}}</span></button></div>
        <div class="conversation-list"><div v-if="!filtered.length" class="empty-small"><MessageCircle :size="30"/><p>{{query?'没有找到匹配的会话':filter==='unread'?'所有留言都已查看':'还没有访客留言'}}</p><small>{{query?'试试其他搜索词':'新的咨询会自动出现在这里'}}</small></div><button v-for="row in filtered" :key="row.id" class="conversation-row" :class="{active:selected?.conversation.id===row.id}" @click="open(row)"><span class="visitor-avatar">{{row.visitorLabel.slice(-2)}}</span><div class="conversation-row-content"><div><strong>{{row.visitorLabel}}</strong><time>{{dateTime(row.updatedAt)}}</time></div><p>{{row.lastMessage||'新会话'}}</p></div><span v-if="row.unreadCount" class="unread-count">{{row.unreadCount>99?'99+':row.unreadCount}}</span></button></div>
      </aside>
      <section class="conversation-detail" v-loading="detailLoading">
        <template v-if="selected">
          <header class="conversation-detail-header"><button class="icon-btn conversation-back" aria-label="返回会话列表" @click="back"><ArrowLeft :size="18"/></button><span class="visitor-avatar">{{selected.conversation.visitorLabel.slice(-2)}}</span><div><h3>{{selected.conversation.visitorLabel}}</h3><p>首次留言 {{dateTime(selected.conversation.createdAt)}}</p></div><span class="private-label"><ShieldCheck :size="13"/>私密会话</span></header>
          <div ref="messageList" class="admin-messages"><div class="message-start">会话开始于 {{dateTime(selected.conversation.createdAt)}}</div><div v-for="message in selected.messages" :key="message.id" class="admin-message" :class="{outgoing:message.role==='admin',automatic:message.role==='assistant'}"><div class="message-role">{{message.role==='admin'?'管理员':message.role==='assistant'?'服务助手 · 自动回复':selected.conversation.visitorLabel}}<time>{{dateTime(message.createdAt)}}</time></div><div class="admin-message-bubble" :class="{'media-message-bubble':message.type==='image'||message.type==='video'}"><button v-if="message.type==='image' && message.mediaUrl" type="button" class="admin-message-image" aria-label="查看图片大图" @click="preview=message.mediaUrl"><img :src="message.mediaUrl" :alt="message.fileName || '消息图片'" loading="lazy" @load="mediaLoaded"/></button><video v-else-if="message.type==='video' && message.mediaUrl" :src="message.mediaUrl" controls playsinline preload="metadata" :aria-label="message.fileName || '消息视频'"></video><div v-else-if="message.type==='richtext'" class="safe-richtext" v-html="safeRichText(message.content)"></div><template v-else>{{message.content}}</template></div></div></div>
          <form class="admin-reply" @submit.prevent="send()"><div class="reply-label"><MessageCircle :size="14"/>回复访客<span>回复会自动同步到访客页面</span></div><RichTextEditor v-model="reply" :disabled="sending||uploading" @send="send()"/><div class="reply-footer"><div class="reply-media-actions"><button type="button" :disabled="sending||uploading" title="发送图片，最大 5 MB" @click="choose('image')"><ImagePlus :size="17"/><span>图片</span></button><button type="button" :disabled="sending||uploading" title="发送 MP4 / WebM 视频，最大 25 MB" @click="choose('video')"><Video :size="17"/><span>视频</span></button><span v-if="uploading" class="admin-upload-progress"><LoaderCircle :size="14"/>正在上传并发送…</span><small v-else>{{replyPlain.length}} / 4000</small></div><el-button type="primary" native-type="submit" :loading="sending" :disabled="!replyPlain||uploading"><Send :size="14"/>发送回复</el-button></div><input ref="mediaInput" type="file" :accept="mediaKind==='image'?'image/jpeg,image/png,image/webp,image/avif':'video/mp4,video/webm'" hidden @change="upload"/></form>
        </template>
        <div v-else class="conversation-empty"><span class="conversation-empty-icon"><MessageCircle :size="38" :stroke-width="1.1"/></span><h3>一份认真回复，从这里开始</h3><p>选择左侧会话，查看访客的问题。<br/>支持富文本、图片和视频回复。</p><span class="empty-security"><ShieldCheck :size="13"/>仅管理员与对应访客可查看</span></div>
      </section>
    </div>
    <MediaPreview :src="preview" @close="preview=''"/>
  </section>
</template>
