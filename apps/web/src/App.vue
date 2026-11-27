<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowDown, ArrowRight, BellRing, Check, ChevronRight, CircleHelp, ExternalLink, ImagePlus, LoaderCircle, Megaphone, Plus, RefreshCw, ShieldCheck, Smile, Video, X } from 'lucide-vue-next';
import DOMPurify from 'dompurify';
import type { BootstrapResponse, ChatMessage, SiteDocument } from '@yp666/shared';
import { richTextFontFamilies, richTextFontSizes } from '@yp666/shared';
import { api, ApiError } from './api';
import { formatChatTime, needsTimeSeparator } from './chat-time';
import SliderVerification from './components/SliderVerification.vue';
import TurnstileVerification from './components/TurnstileVerification.vue';
import VideoPlayer from './components/VideoPlayer.vue';

const bootstrap = ref<BootstrapResponse | null>(null);
const content = ref<SiteDocument | null>(null);
const messages = ref<ChatMessage[]>([]);
const loading = ref(true);
const entering = ref(false);
const fatalError = ref('');
const sendError = ref('');
const text = ref('');
const sending = ref(false);
const uploadProgress = ref<number | null>(null);
const showHelp = ref(false);
const showEmoji = ref(false);
const showAttachments = ref(false);
const imagePreview = ref<{url: string; title: string} | null>(null);
const scroller = ref<HTMLElement>();
const composer = ref<HTMLTextAreaElement>();
const imageInput = ref<HTMLInputElement>();
const videoInput = ref<HTMLInputElement>();
const dialog = ref<HTMLElement>();
const showScrollBottom = ref(false);
const liveNotice = ref('');
const replyToast = ref('');
const unread = ref(0);
const soundEnabled = ref(true);
const notificationPermission = ref<NotificationPermission | 'unsupported'>('unsupported');
const composing = ref(false);
const emojis = ['😀','😊','🥰','😍','😎','🤔','😭','😂','🤣','🥳','😅','😉','🤗','😇','🥺','👍','👏','🙌','🙏','🤝','👌','✌️','❤️','💚','💛','💯','🔥','🎉','🌹','🌸','☀️','🌈','🎁','✅','☕','🍀'];
let poll: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pollInFlight = false;
let disposed = false;
let lastSettingsCheck = 0;
let lastVisitCheck = 0;
let audio: AudioContext | undefined;
let activeUpload: XMLHttpRequest | undefined;
let previousFocus: HTMLElement | null = null;
let historyRevision = 0;

const brand = computed(() => content.value?.settings.brandName || bootstrap.value?.site.brandName || '在线客服');
const primaryColor = computed(() => content.value?.settings.primaryColor || bootstrap.value?.site.primaryColor || '#547861');
const mustVerify = computed(() => !!bootstrap.value?.verificationRequired && !bootstrap.value?.verified);
const pageTitle = computed(() => content.value?.settings.pageTitle || bootstrap.value?.site.pageTitle || '在线客服');
const loadingText = computed(() => content.value?.settings.loadingText || bootstrap.value?.site.loadingText || '正在加载，请稍候…');
const serviceNameSize = computed(() => {
  const size = Number(content.value?.settings.serviceNameFontSize ?? bootstrap.value?.site.serviceNameFontSize ?? 14);
  return Number.isFinite(size) ? Math.min(18, Math.max(12, Math.round(size))) : 14;
});
const defaultFavicon = '/assets/favicon.svg';
const faviconUrl = computed(() => safeAsset(content.value?.settings.faviconUrl ?? bootstrap.value?.site.faviconUrl) || defaultFavicon);
const blocks = computed(() => content.value?.blocks.filter(block => block.enabled).sort((a, b) => a.sortOrder - b.sortOrder) || []);
const faqs = computed(() => content.value?.faqs.filter(faq => faq.enabled) || []);
const visibleMessages = computed(() => messages.value.filter(message => !(message.role === 'assistant' && (!message.type || message.type === 'text') && message.content === content.value?.settings.welcomeMessage)));
const timelineMessages = computed(() => visibleMessages.value.map((message, index, history) => ({
  message,
  separator: needsTimeSeparator(message.createdAt, history[index - 1]?.createdAt) ? formatChatTime(message.createdAt) : '',
})));
const announcement = computed(() => content.value?.settings.announcement || '');
const avatarStyle = computed(() => ({borderRadius: content.value?.settings.avatarShape === 'circle' ? '50%' : content.value?.settings.avatarShape === 'square' ? '0' : '9px'}));
const gateBackground = computed(() => backgroundStyle(bootstrap.value?.site.verificationBackgroundUrl));
const chatBackground = computed(() => backgroundStyle(content.value?.settings.chatBackgroundUrl || content.value?.settings.backgroundUrl));

function safeLink(value: string): string | undefined { return /^https?:\/\//i.test(value) ? value : undefined; }
function safeAsset(value: string | undefined): string | undefined { return value && (/^https?:\/\//i.test(value) || /^\/(?:assets|uploads)\/[\w./-]+$/.test(value)) ? value : undefined; }
function backgroundStyle(value: string | undefined) { const url = safeAsset(value); return url ? {backgroundImage: `linear-gradient(rgba(247,249,244,.2),rgba(247,249,244,.2)), url(${JSON.stringify(url)})`} : {}; }
function imageFallback(event: Event) { const image = event.target as HTMLImageElement; if (!image.src.endsWith('/assets/avatar.svg')) image.src = '/assets/avatar.svg'; }
function pause(milliseconds: number) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

function richText(value: string) {
  const clean = DOMPurify.sanitize(value, {ALLOWED_TAGS: ['p','div','br','span','strong','b','em','i','u','s','a','ul','ol','li','blockquote','code'], ALLOWED_ATTR: ['style','href','target','rel'], ALLOW_DATA_ATTR: false});
  const root = new DOMParser().parseFromString(clean, 'text/html').body;
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const {color, backgroundColor, fontSize, fontFamily, textAlign} = element.style;
    element.removeAttribute('style');
    const safeColor = /^(#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i;
    if (color && safeColor.test(color) && CSS.supports('color', color)) element.style.color = color;
    if (backgroundColor && safeColor.test(backgroundColor) && CSS.supports('color', backgroundColor)) element.style.backgroundColor = backgroundColor;
    if (richTextFontSizes.some(size => fontSize === `${size}px`)) element.style.fontSize = fontSize;
    const family = fontFamily.replace(/^["']|["']$/g, '');
    if (richTextFontFamilies.some(allowed => allowed.toLowerCase() === family.toLowerCase())) element.style.fontFamily = family;
    if (['left', 'center', 'right'].includes(textAlign)) element.style.textAlign = textAlign;
  }
  for (const link of root.querySelectorAll('a')) {
    if (!safeLink(link.getAttribute('href') || '')) link.removeAttribute('href');
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  return root.innerHTML;
}
function messageSummary(message: ChatMessage) {
  if (message.type === 'image') return '客服发来了一张图片';
  if (message.type === 'video') return '客服发来了一段视频';
  return message.type === 'richtext' ? DOMPurify.sanitize(message.content, {ALLOWED_TAGS: [], ALLOWED_ATTR: []}).slice(0, 80) : message.content.slice(0, 80);
}
async function initialize() {
  const started = Date.now(); loading.value = true; fatalError.value = '';
  try { bootstrap.value = await api<BootstrapResponse>('/public/bootstrap'); lastVisitCheck = Date.now(); if (!mustVerify.value) await loadRoom(); }
  catch (error) { fatalError.value = error instanceof Error ? error.message : '页面加载失败，请重试'; }
  finally { await pause(Math.max(0, 650 - (Date.now() - started))); loading.value = false; }
}
async function loadRoom() {
  const started = Date.now(); entering.value = true;
  try {
    const [document, history] = await Promise.all([api<SiteDocument>('/public/content'), api<ChatMessage[]>('/visitor/messages')]);
    content.value = document; messages.value = history;
    if (bootstrap.value) bootstrap.value.verified = true;
    sendError.value = ''; lastSettingsCheck = Date.now(); await nextTick();
    if (history.some(message => message.role === 'visitor' || message.role === 'admin')) scrollBottom(false);
  } catch (error) { if (error instanceof ApiError && error.status === 403) expireSession(); else throw error; }
  finally { await pause(Math.max(0, 500 - (Date.now() - started))); entering.value = false; await nextTick(); if (messages.value.some(message => message.role === 'visitor')) scrollBottom(false); }
}
async function verified() {
  fatalError.value = ''; if (bootstrap.value) bootstrap.value.verified = true;
  try { await loadRoom(); } catch (error) { fatalError.value = error instanceof Error ? error.message : '加载失败，请重试'; }
}
function expireSession() {
  if (bootstrap.value) { bootstrap.value.verified = false; bootstrap.value.verificationRequired = true; }
  content.value = null; fatalError.value = '访问验证已过期，重新验证后可继续对话。'; showAttachments.value = false; showEmoji.value = false;
}
function nearBottom() { return !scroller.value || scroller.value.scrollHeight - scroller.value.scrollTop - scroller.value.clientHeight < 160; }
function clearUnread() { unread.value = 0; replyToast.value = ''; }
function scrollBottom(smooth = true, dismissToast = true) { scroller.value?.scrollTo({top: scroller.value.scrollHeight, behavior: smooth ? 'smooth' : 'instant'}); if (dismissToast) clearUnread(); else unread.value = 0; }
function onScroll() { showScrollBottom.value = !nearBottom(); if (!document.hidden && nearBottom()) unread.value = 0; }
function onMediaLoaded() { if (!showScrollBottom.value && !document.hidden) scrollBottom(false, false); onScroll(); }
function resizeComposer() { if (composer.value) { composer.value.style.height = 'auto'; composer.value.style.height = `${Math.min(120, Math.max(26, composer.value.scrollHeight))}px`; } }
function unlockAudio() {
  if (!soundEnabled.value || content.value?.settings.notificationSound === false) return;
  try { audio ||= new AudioContext(); if (audio.state === 'suspended') void audio.resume(); } catch { /* Visual notifications remain available. */ }
}
function playNotification() {
  if (!soundEnabled.value || content.value?.settings.notificationSound === false || !audio || audio.state !== 'running') return;
  try {
    const start = audio.currentTime;
    for (const [offset, frequency] of [[0, 660], [.16, 880]]) {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency!;
      gain.gain.setValueAtTime(0, start + offset!); gain.gain.linearRampToValueAtTime(.11, start + offset! + .025); gain.gain.exponentialRampToValueAtTime(.001, start + offset! + .18);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start + offset!); oscillator.stop(start + offset! + .2);
    }
  } catch { /* Browser audio restrictions do not block replies. */ }
}
function notifyReplies(incoming: ChatMessage[]) {
  if (!incoming.length) return;
  const latest = incoming.at(-1)!;
  liveNotice.value = `收到客服回复：${messageSummary(latest)}`; replyToast.value = messageSummary(latest);
  if (document.hidden || !nearBottom()) unread.value += incoming.length;
  if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => replyToast.value = '', 7000); playNotification();
  if (document.hidden && notificationPermission.value === 'granted') {
    try { const notification = new Notification('客服有新回复', {body: messageSummary(latest), tag: 'yp666-reply'}); notification.onclick = () => { window.focus(); scrollBottom(); notification.close(); }; } catch { /* Page hint is the fallback. */ }
  }
}
async function applyHistory(history: ChatMessage[], notify = true) {
  const old = new Set(messages.value.map(message => message.id)); const stick = nearBottom();
  if (notify) notifyReplies(history.filter(message => message.role === 'admin' && !old.has(message.id)));
  messages.value = history; historyRevision++; await nextTick();
  if (stick && !document.hidden) scrollBottom(true, false); else showScrollBottom.value = !nearBottom();
}
async function send(value = text.value) {
  const message = value.trim(); if (!message || sending.value || !content.value) return;
  if (message.length > 4000) { sendError.value = '每条消息最多 4000 个字符'; return; }
  sending.value = true; sendError.value = ''; showEmoji.value = false; showAttachments.value = false;
  try {
    await applyHistory(await api<ChatMessage[]>('/visitor/messages', {method: 'POST', body: JSON.stringify({type: 'text', content: message})}));
    if (text.value.trim() === message) text.value = '';
    showHelp.value = false; liveNotice.value = '消息已发送'; await nextTick(); resizeComposer(); scrollBottom();
  } catch (error) { handleSendError(error); } finally { sending.value = false; }
}
function handleSendError(error: unknown) { if (error instanceof ApiError && error.status === 403) expireSession(); else sendError.value = error instanceof Error ? error.message : '发送失败，请重试'; }
function onComposerKeydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing.value && window.matchMedia('(pointer: fine)').matches) { event.preventDefault(); void send(); } }
async function insertEmoji(emoji: string) {
  const start = composer.value?.selectionStart ?? text.value.length; const end = composer.value?.selectionEnd ?? start;
  text.value = text.value.slice(0, start) + emoji + text.value.slice(end);
  await nextTick(); composer.value?.focus(); composer.value?.setSelectionRange(start + emoji.length, start + emoji.length); resizeComposer();
}
function uploadFile(file: File) {
  return new Promise<{url: string; type: 'image' | 'video'; fileName: string}>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); activeUpload = xhr; xhr.open('POST', '/api/visitor/uploads'); xhr.withCredentials = true; xhr.timeout = 180000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) uploadProgress.value = Math.min(99, Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { let result; try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('上传失败，请重试')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(result); else reject(new ApiError(xhr.status, result.message || '上传失败，请重试')); };
    xhr.onerror = () => reject(new Error('网络连接中断，请重试')); xhr.ontimeout = () => reject(new Error('上传超时，请重试')); xhr.onabort = () => reject(new Error('上传已取消'));
    const form = new FormData(); form.append('file', file); xhr.send(form);
  });
}
async function selectFile(event: Event, expectedType: 'image' | 'video') {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file || sending.value) return;
  if (!file.type.startsWith(expectedType + '/')) { sendError.value = `请选择${expectedType === 'image' ? '图片' : '视频'}文件`; return; }
  if (file.size > (expectedType === 'image' ? 5 : 25) * 1024 * 1024) { sendError.value = expectedType === 'image' ? '图片最大支持 5 MB' : '视频最大支持 25 MB'; return; }
  sending.value = true; uploadProgress.value = 0; sendError.value = ''; showAttachments.value = false;
  try {
    const media = await uploadFile(file); uploadProgress.value = 100;
    await applyHistory(await api<ChatMessage[]>('/visitor/messages', {method: 'POST', body: JSON.stringify({type: media.type, mediaUrl: media.url, fileName: media.fileName, content: ''})}));
    liveNotice.value = `${expectedType === 'image' ? '图片' : '视频'}已发送`; scrollBottom();
  } catch (error) { handleSendError(error); } finally { sending.value = false; uploadProgress.value = null; activeUpload = undefined; }
}
async function refreshMessages() {
  if (disposed || loading.value || entering.value || pollInFlight) return; pollInFlight = true;
  try {
    // Only visible pages send visit heartbeats. Message polling stays active for reply notifications.
    if (!document.hidden && (Date.now() - lastVisitCheck > 60000 || (!content.value && Date.now() - lastSettingsCheck > 12000))) {
      bootstrap.value = await api<BootstrapResponse>('/public/bootstrap'); lastVisitCheck = Date.now();
      if (!content.value) lastSettingsCheck = Date.now();
      if (mustVerify.value && content.value) { expireSession(); return; }
    }
    if (!content.value) return;
    if (!sending.value) { const revision = historyRevision; const history = await api<ChatMessage[]>('/visitor/messages'); if (!sending.value && revision === historyRevision && (history.length !== messages.value.length || history.at(-1)?.id !== messages.value.at(-1)?.id)) await applyHistory(history); }
    if (Date.now() - lastSettingsCheck > 12000) { content.value = await api<SiteDocument>('/public/content'); lastSettingsCheck = Date.now(); }
  } catch (error) { if (error instanceof ApiError && error.status === 403) expireSession(); } finally { pollInFlight = false; }
}
function onVisibility() { if (!document.hidden) { if (nearBottom()) clearUnread(); void refreshMessages(); } }
function closeDialogs() { showHelp.value = false; imagePreview.value = null; showEmoji.value = false; showAttachments.value = false; }
function trapDialogKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { closeDialogs(); return; }
  if (event.key !== 'Tab' || !dialog.value || (!showHelp.value && !imagePreview.value)) return;
  const items = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')]; const first = items[0]; const last = items.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch([pageTitle, unread], () => { document.title = `${unread.value ? `（${unread.value}条新消息）` : ''}${pageTitle.value}`; }, {immediate: true});
watch(faviconUrl, (url, _previous, onCleanup) => {
  let active = true;
  function applyIcon(href: string) {
    if (!active) return;
    for (const rel of ['icon', 'apple-touch-icon']) {
      let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {link = document.createElement('link'); link.rel = rel; document.head.appendChild(link);}
      link.removeAttribute('type');
      link.href = href;
    }
  }
  if (url === defaultFavicon) {applyIcon(defaultFavicon); return;}
  const image = new Image();
  image.onload = () => applyIcon(url);
  image.onerror = () => applyIcon(defaultFavicon);
  image.src = url;
  onCleanup(() => {active = false; image.onload = null; image.onerror = null;});
}, {immediate: true});
watch(() => !!(showHelp.value || imagePreview.value), async open => { if (open) { previousFocus = document.activeElement as HTMLElement | null; await nextTick(); dialog.value?.querySelector<HTMLElement>('button')?.focus(); } else previousFocus?.focus(); });
onMounted(() => {
  try { soundEnabled.value = localStorage.getItem('yp666-reply-sound') !== 'false'; } catch { /* Optional preference. */ }
  if ('Notification' in window) notificationPermission.value = Notification.permission;
  void initialize(); poll = setInterval(() => void refreshMessages(), 4000);
  document.addEventListener('keydown', trapDialogKeys); document.addEventListener('visibilitychange', onVisibility); document.addEventListener('pointerdown', unlockAudio); document.addEventListener('keydown', unlockAudio);
});
onBeforeUnmount(() => { disposed = true; if (poll) clearInterval(poll); if (toastTimer) clearTimeout(toastTimer); activeUpload?.abort(); void audio?.close(); document.removeEventListener('keydown', trapDialogKeys); document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('pointerdown', unlockAudio); document.removeEventListener('keydown', unlockAudio); });
</script>

<template>
  <div class="site-shell" :class="{ 'room-active': !!content && !mustVerify }" :style="{ '--primary': primaryColor, '--service-name-size': `${serviceNameSize}px`, ...(content && !mustVerify ? chatBackground : gateBackground) }">
    <main v-if="!loading && !bootstrap" class="connection-error"><ShieldCheck :size="38" /><h1>暂时无法连接</h1><p>{{ fatalError }}</p><button class="primary-button" @click="initialize">重新连接 <RefreshCw :size="17" /></button></main>
    <main v-else-if="!loading && (mustVerify || !content)" class="verification-screen" :style="gateBackground">
      <section class="verification-dialog" role="dialog" aria-modal="true" aria-labelledby="verification-title">
        <div class="verification-title"><ShieldCheck :size="24" /><div><h1 id="verification-title">安全验证</h1><p>完成验证后进入聊天</p></div></div>
        <p v-if="fatalError" class="gate-inline-error" role="alert">{{ fatalError }}</p>
        <TurnstileVerification v-if="bootstrap?.captchaProvider === 'turnstile' && bootstrap.turnstileSiteKey" :site-key="bootstrap.turnstileSiteKey" @verified="verified" />
        <SliderVerification v-else-if="mustVerify" @verified="verified" />
        <button v-else class="primary-button verification-enter" @click="verified">进入聊天 <ArrowRight :size="17" /></button>
      </section>
    </main>
    <main v-else-if="content && !mustVerify" class="room-layout">
      <section class="chat-room" aria-label="在线会客厅" :style="chatBackground">
        <div v-if="announcement" class="room-topline">
          <div v-if="announcement" class="announcement" :style="{ '--announcement-duration': `${content.settings.announcementSpeed || 24}s` }"><Megaphone :size="18" /><div class="announcement-window" tabindex="0" :aria-label="announcement"><div class="announcement-track" aria-hidden="true"><span>{{ announcement }}</span><span>{{ announcement }}</span></div></div></div>
        </div>
        <button v-if="replyToast" class="reply-toast" type="button" @click="scrollBottom()"><BellRing :size="17" /><span><strong>客服有新回复</strong>{{ replyToast }}</span><ArrowDown :size="17" /></button>
        <div ref="scroller" class="chat-scroll" tabindex="0" aria-label="对话内容" @scroll="onScroll">
          <div v-if="content.settings.welcomeMessage" class="message-group assistant-message"><img class="message-avatar" :style="avatarStyle" :src="content.settings.avatarUrl || '/assets/avatar.svg'" alt="客服头像" @error="imageFallback" /><div class="message-main"><span class="message-author">{{ brand }} · 服务助手</span><div class="message-bubble welcome-bubble"><p>{{ content.settings.welcomeMessage }}</p></div></div></div>
          <div v-for="block in blocks" :key="block.id" class="message-group assistant-message content-message">
            <div class="message-avatar-spacer"></div>
            <article class="content-card" :class="`content-card-${block.type}`">
              <button v-if="block.type === 'image' && safeAsset(block.imageUrl)" class="content-image-button" type="button" :aria-label="`查看大图：${block.title || '服务介绍图片'}`" @click="imagePreview = {url: block.imageUrl, title: block.title || '服务介绍图片'}"><img class="content-card-image" :src="block.imageUrl" :alt="block.title || '服务介绍图片'" loading="lazy" /></button>
              <VideoPlayer v-else-if="block.type === 'video' && safeAsset(block.videoUrl)" class="content-card-video" :src="block.videoUrl" :label="block.title || '服务介绍视频'"/>
              <div v-if="block.title || block.content || block.type === 'link'" class="content-card-copy">
                <h3 v-if="block.title">{{ block.title }}</h3>
                <div v-if="block.content && block.contentFormat === 'richtext'" class="rich-message content-richtext" v-html="richText(block.content)"></div>
                <p v-else-if="block.content">{{ block.content }}</p>
                <a v-if="block.type === 'link' && safeLink(block.url)" :href="safeLink(block.url)" target="_blank" rel="noopener noreferrer" class="content-link">{{ block.buttonText || '了解更多' }}<ExternalLink :size="15" /></a>
              </div>
            </article>
          </div>
          <div v-if="faqs.length" class="faq-section"><div class="faq-heading"><CircleHelp :size="14" /><span>常见问题</span></div><div class="faq-list"><button v-for="faq in faqs" :key="faq.id" class="faq-chip" type="button" :disabled="sending" @click="send(faq.question)">{{ faq.question }}<ChevronRight :size="14" /></button></div></div>
          <template v-for="{message, separator} in timelineMessages" :key="message.id">
          <div v-if="separator" class="date-divider message-time-divider"><span></span><time :datetime="message.createdAt">{{ separator }}</time><span></span></div>
          <div class="message-group" :class="message.role === 'visitor' ? 'visitor-message' : 'assistant-message'">
            <img v-if="message.role !== 'visitor'" class="message-avatar" :style="avatarStyle" :src="content.settings.avatarUrl || '/assets/avatar.svg'" alt="客服头像" @error="imageFallback" />
            <div class="message-main"><span class="message-author">{{ message.role === 'visitor' ? '你' : `${brand} · ${message.role === 'admin' ? '客服回复' : '服务助手'}` }}</span><div class="message-bubble" :class="{'media-bubble': message.type === 'image' || message.type === 'video'}"><button v-if="message.type === 'image' && safeAsset(message.mediaUrl)" class="message-image-button" type="button" aria-label="查看消息大图" @click="imagePreview = {url: message.mediaUrl!, title: message.fileName || '消息图片'}"><img class="message-image" :src="message.mediaUrl" :alt="message.fileName || '消息图片'" loading="lazy" @load="onMediaLoaded" /></button><VideoPlayer v-else-if="message.type === 'video' && safeAsset(message.mediaUrl)" class="message-video" :src="message.mediaUrl!" @loadedmetadata="onMediaLoaded" :label="message.fileName || '消息视频'"/><div v-else-if="message.type === 'richtext' && message.role !== 'visitor'" class="rich-message" v-html="richText(message.content)"></div><p v-else>{{ message.content }}</p></div><span v-if="message.role === 'visitor'" class="message-sent"><Check :size="11" /> 已发送</span></div>
          </div>
          </template>
          <div v-if="sending" class="sending-indicator"><span></span><span></span><span></span><span class="sr-only">正在发送消息</span></div><div class="chat-scroll-end"></div>
        </div>
        <button v-if="showScrollBottom || unread" class="scroll-bottom" type="button" @click="scrollBottom()"><ArrowDown :size="16" />{{ unread ? `${unread} 条新回复` : '回到最新消息' }}</button>
        <footer class="composer-area">
          <div v-if="sendError" class="send-error" role="alert">{{ sendError }}<button type="button" class="icon-button" aria-label="关闭错误提示" @click="sendError = ''"><X :size="15" /></button></div>
          <div v-if="uploadProgress !== null" class="upload-progress" role="status"><LoaderCircle :size="15" class="spinning" /><span>{{ uploadProgress === 100 ? '正在发送…' : `正在上传 ${uploadProgress}%` }}</span><progress :value="uploadProgress" max="100"></progress></div>
          <div v-if="showEmoji" class="emoji-panel"><div class="panel-heading"><span>选择表情</span><button class="icon-button" type="button" aria-label="关闭表情" @click="showEmoji = false"><X :size="17" /></button></div><div class="emoji-grid"><button v-for="emoji in emojis" :key="emoji" type="button" :aria-label="`插入表情 ${emoji}`" @click="insertEmoji(emoji)">{{ emoji }}</button></div></div>
          <div v-if="showAttachments" class="attachment-panel"><button type="button" :disabled="sending" @click="imageInput?.click()"><ImagePlus :size="24" /><strong>发送图片</strong><small>JPG / PNG / WebP · 5 MB</small></button><button type="button" :disabled="sending" @click="videoInput?.click()"><Video :size="24" /><strong>发送视频</strong><small>MP4 / WebM · 25 MB</small></button></div>
          <form class="composer-form" @submit.prevent="send()"><textarea ref="composer" v-model="text" rows="1" maxlength="4000" :placeholder="content.settings.contactHint || '输入消息…'" aria-label="咨询消息" @input="resizeComposer" @keydown="onComposerKeydown" @compositionstart="composing = true" @compositionend="composing = false"></textarea><button v-if="text.trim()" class="text-send-button" type="submit" :disabled="sending" aria-label="发送消息"><LoaderCircle v-if="sending" :size="20" class="spinning" /><ArrowRight v-else :size="20" /></button><button class="composer-icon emoji-toggle" type="button" aria-label="选择表情" :aria-expanded="showEmoji" @click="showEmoji = !showEmoji; showAttachments = false"><Smile :size="24" /></button><button class="composer-icon attachment-toggle" type="button" aria-label="发送图片或视频" :disabled="sending" :aria-expanded="showAttachments" @click="showAttachments = !showAttachments; showEmoji = false"><Plus :size="27" :class="{'plus-open': showAttachments}" /></button></form>
          <input ref="imageInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-label="上传聊天图片" @change="selectFile($event, 'image')" /><input ref="videoInput" class="sr-only" type="file" accept="video/mp4,video/webm" aria-label="上传聊天视频" @change="selectFile($event, 'video')" />
        </footer>
      </section>
    </main>
    <div v-if="loading || entering" class="loading-screen" role="status" aria-live="polite"><LoaderCircle class="spinning" :size="46" /><p>{{ loadingText }}</p><span class="loading-dots"><i></i><i></i><i></i></span></div>
    <div class="sr-only" aria-live="polite">{{ liveNotice }}</div>
    <div v-if="imagePreview" class="image-lightbox" @click.self="imagePreview = null"><section ref="dialog" class="lightbox-content" role="dialog" aria-modal="true" aria-label="图片大图预览"><button class="lightbox-close" type="button" aria-label="关闭大图" @click="imagePreview = null"><X :size="27" /></button><img :src="imagePreview.url" :alt="imagePreview.title" /><p>{{ imagePreview.title }}</p></section></div>
    <div v-else-if="showHelp" class="dialog-backdrop" @click.self="showHelp = false"><section ref="dialog" class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">常见问题</h2><button class="icon-button" type="button" aria-label="关闭帮助" @click="showHelp = false"><X :size="22" /></button></div><button v-for="faq in faqs" :key="faq.id" class="help-question" type="button" :disabled="sending" @click="send(faq.question)">{{ faq.question }}<ChevronRight :size="17" /></button><p v-if="!faqs.length">请在聊天窗口中留言，客服回复会自动显示。</p></section></div>
  </div>
</template>
