<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, ExternalLink, Leaf, LoaderCircle, LockKeyhole, MessageCircle, Megaphone, RefreshCw, Send, ShieldCheck, Sparkles, X } from 'lucide-vue-next';
import type { BootstrapResponse, ChatMessage, SiteDocument } from '@yp666/shared';
import { api, ApiError } from './api';
import BrandMark from './components/BrandMark.vue';
import SliderVerification from './components/SliderVerification.vue';
import TurnstileVerification from './components/TurnstileVerification.vue';

const bootstrap = ref<BootstrapResponse | null>(null);
const content = ref<SiteDocument | null>(null);
const messages = ref<ChatMessage[]>([]);
const loading = ref(true);
const entering = ref(false);
const fatalError = ref('');
const sendError = ref('');
const text = ref('');
const sending = ref(false);
const noticeDismissed = ref(false);
const showHelp = ref(false);
const scroller = ref<HTMLElement>();
const composer = ref<HTMLTextAreaElement>();
const showScrollBottom = ref(false);
const liveNotice = ref('');
const helpDialog = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
let pollInFlight = false;
let disposed = false;
const composing = ref(false);

const brand = computed(() => bootstrap.value?.site.brandName || '青屿');
const primaryColor = computed(() => content.value?.settings.primaryColor || bootstrap.value?.site.primaryColor || '#547861');
const mustVerify = computed(() => !!bootstrap.value?.verificationRequired && !bootstrap.value?.verified);
const blocks = computed(() => content.value?.blocks.filter(block => block.enabled).sort((a, b) => a.sortOrder - b.sortOrder) || []);
const faqs = computed(() => content.value?.faqs.filter(faq => faq.enabled) || []);
const visibleMessages = computed(() => messages.value.filter(message => !(message.role === 'assistant' && message.content === content.value?.settings.welcomeMessage)));
const today = new Intl.DateTimeFormat('zh-CN', {month: 'long', day: 'numeric'}).format(new Date());
const announcement = computed(() => content.value?.settings.announcement || '');

function safeLink(value: string): string | undefined {
  return /^https?:\/\//i.test(value) ? value : undefined;
}
function imageFallback(event: Event) {
  const image = event.target as HTMLImageElement;
  if (!image.src.endsWith('/assets/avatar.svg')) image.src = '/assets/avatar.svg';
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false}).format(date);
}

async function initialize() {
  loading.value = true;
  fatalError.value = '';
  try {
    bootstrap.value = await api<BootstrapResponse>('/public/bootstrap');
    document.title = `${brand.value} · 在线会客厅`;
    if (!mustVerify.value) await loadRoom();
  } catch (e) { fatalError.value = e instanceof Error ? e.message : '页面加载失败，请重试'; }
  finally { loading.value = false; }
}

async function loadRoom() {
  entering.value = true;
  try {
    const [document, history] = await Promise.all([api<SiteDocument>('/public/content'), api<ChatMessage[]>('/visitor/messages')]);
    content.value = document;
    messages.value = history;
    if (bootstrap.value) bootstrap.value.verified = true;
    sendError.value = '';
    await nextTick();
    if (history.some(message => message.role === 'visitor' || message.role === 'admin')) scrollBottom(false);
    else scroller.value?.scrollTo({top: 0, behavior: 'instant'});
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      if (bootstrap.value) { bootstrap.value.verified = false; bootstrap.value.verificationRequired = true; }
      content.value = null;
    } else { throw e; }
  } finally { entering.value = false; }
}

async function verified() {
  fatalError.value = '';
  if (bootstrap.value) bootstrap.value.verified = true;
  try { await loadRoom(); }
  catch (e) { fatalError.value = e instanceof Error ? e.message : '会客厅加载失败，请重试'; }
}

function scrollBottom(smooth = true) {
  scroller.value?.scrollTo({top: scroller.value.scrollHeight, behavior: smooth ? 'smooth' : 'instant'});
}
function onScroll() {
  if (!scroller.value) return;
  showScrollBottom.value = scroller.value.scrollHeight - scroller.value.scrollTop - scroller.value.clientHeight > 200;
}
function resizeComposer() {
  if (!composer.value) return;
  composer.value.style.height = 'auto';
  composer.value.style.height = `${Math.min(120, Math.max(24, composer.value.scrollHeight))}px`;
}

async function send(value = text.value) {
  const message = value.trim();
  if (!message || sending.value || !content.value) return;
  if (message.length > 2000) { sendError.value = '每条消息最多 2000 个字符，请精简后发送。'; return; }
  sending.value = true;
  sendError.value = '';
  try {
    messages.value = await api<ChatMessage[]>('/visitor/messages', {method: 'POST', body: JSON.stringify({content: message})});
    if (text.value.trim() === message) text.value = '';
    showHelp.value = false;
    liveNotice.value = '消息已发送';
    await nextTick(); resizeComposer(); scrollBottom();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      if (bootstrap.value) { bootstrap.value.verified = false; bootstrap.value.verificationRequired = true; }
      content.value = null;
      fatalError.value = '本次访问验证已过期，重新验证后即可继续对话。';
    } else { sendError.value = e instanceof Error ? e.message : '发送失败，你的输入已保留，请重试。'; }
  } finally { sending.value = false; }
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing.value && window.matchMedia('(pointer: fine)').matches) {
    event.preventDefault(); void send();
  }
}

function trapDialogKeys(event: KeyboardEvent) {
  if (!showHelp.value) return;
  if (event.key === 'Escape') { showHelp.value = false; return; }
  if (event.key !== 'Tab' || !helpDialog.value) return;
  const items = [...helpDialog.value.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

watch(showHelp, async value => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    helpDialog.value?.querySelector<HTMLElement>('button')?.focus();
  } else { previousFocus?.focus(); }
});

async function refreshMessages() {
  if (disposed || !content.value || document.hidden || sending.value || pollInFlight) return;
  pollInFlight = true;
  try {
    const history = await api<ChatMessage[]>('/visitor/messages');
    const changed = history.length !== messages.value.length || history.at(-1)?.id !== messages.value.at(-1)?.id;
    if (changed) {
      const nearBottom = !scroller.value || scroller.value.scrollHeight - scroller.value.scrollTop - scroller.value.clientHeight < 160;
      messages.value = history;
      liveNotice.value = '收到新回复';
      await nextTick();
      if (nearBottom) scrollBottom(); else showScrollBottom.value = true;
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      if (bootstrap.value) { bootstrap.value.verified = false; bootstrap.value.verificationRequired = true; }
      content.value = null;
      fatalError.value = '验证已过期。重新验证后，你的对话仍会保留。';
    }
  } finally { pollInFlight = false; }
}

onMounted(() => { void initialize(); poll = setInterval(() => void refreshMessages(), 5000); document.addEventListener('keydown', trapDialogKeys); });
onBeforeUnmount(() => { disposed = true; if (poll) clearInterval(poll); document.removeEventListener('keydown', trapDialogKeys); });
</script>

<template>
  <div class="site-shell" :class="{ 'room-active': !!content && !mustVerify }" :style="{ '--primary': primaryColor }">
    <header class="site-header">
      <a href="/" class="wordmark" aria-label="返回首页"><BrandMark /><span>{{ brand }}<span class="wordmark-en">QINGYU</span></span></a>
      <span class="header-location"><span class="tiny-dot"></span> 在线会客厅 <span class="header-divider">/</span> A SPACE FOR CONNECTION</span>
      <button class="header-help" type="button" @click="showHelp = true"><CircleHelp :size="17" /><span>需要帮助</span></button>
    </header>

    <main v-if="loading" class="loading-screen" aria-live="polite"><BrandMark /><LoaderCircle class="spinning" :size="24" /><p>为你准备一个安心的空间…</p></main>

    <main v-else-if="!bootstrap" class="connection-error">
      <div class="error-icon"><Leaf :size="30" /></div><h1>稍等，我们还在这里</h1><p>{{ fatalError }}</p><button class="primary-button" @click="initialize">重新连接 <ArrowRight :size="17" /></button>
    </main>

    <main v-else-if="mustVerify || !content" class="gate-layout">
      <section class="gate-story" aria-labelledby="gate-heading">
        <span class="eyebrow"><span></span> EVERY GOOD CONNECTION STARTS HERE</span>
        <h1 id="gate-heading">给相遇，<br />留一点<span class="serif-accent">安心。</span></h1>
        <p class="gate-description">在开始对话前，完成一个小小的验证。<br />让每一次真诚的连接，都被温柔以待。</p>
        <div class="gate-art">
          <img src="/assets/gate-landscape.svg" alt="绿意山屿间，一条小路通向温暖的会客空间" />
          <div class="art-note"><span class="art-note-line"></span><span>相遇有时，真诚无界</span></div>
          <span class="art-coordinate">30° 16′ N &nbsp; 120° 09′ E</span>
        </div>
        <div class="story-bottom"><span><ShieldCheck :size="16" /> 安心访问</span><i></i><span><MessageCircle :size="16" /> 真诚交流</span><i></i><span><Leaf :size="16" /> 轻松连接</span></div>
      </section>

      <section class="gate-card" aria-labelledby="verification-heading">
        <div class="gate-card-top"><span class="step-label">01 <span>/ 安全验证</span></span><span class="secure-badge"><LockKeyhole :size="12" /> 安全连接</span></div>
        <div class="gate-card-icon"><ShieldCheck :size="29" stroke-width="1.5" /></div>
        <h2 id="verification-heading">欢迎来到{{ brand }}</h2>
        <p class="gate-card-description">距离一段美好的对话，只差这一步。</p>
        <p v-if="fatalError" class="gate-inline-error" role="alert">{{ fatalError }}</p>
        <div v-if="entering" class="entering"><LoaderCircle class="spinning" :size="25" /><span>正在开启会客厅…</span></div>
        <TurnstileVerification v-else-if="bootstrap.captchaProvider === 'turnstile' && bootstrap.turnstileSiteKey" :site-key="bootstrap.turnstileSiteKey" @verified="verified" />
        <SliderVerification v-else-if="mustVerify" @verified="verified" />
        <button v-else class="primary-button" @click="verified">进入会客厅 <ArrowRight :size="17" /></button>
        <div class="gate-card-footer"><LockKeyhole :size="13" /><p>验证仅用于确认本次访问安全，<br />无需提供任何个人信息。</p></div>
      </section>
    </main>

    <main v-else class="room-layout">
      <aside class="room-intro" :style="content.settings.backgroundUrl ? {backgroundImage: `linear-gradient(180deg, rgba(242,244,234,.9), rgba(242,244,234,.96)), url('${content.settings.backgroundUrl}')`} : {}">
        <span class="eyebrow"><span></span> A SPACE FOR YOU</span>
        <h1>{{ content.settings.title }}</h1>
        <p class="room-subtitle">{{ content.settings.subtitle }}</p>
        <div class="room-art-card"><img src="/assets/landscape.svg" alt="层叠青山与平静湖面" /><div class="room-art-label"><span>慢下来，听见美好</span><span>TAKE A MOMENT.</span></div></div>
        <div class="intro-small-note"><span class="note-star">✳</span><div><strong>{{ content.settings.introTitle }}</strong><p>{{ content.settings.introText }}</p></div></div>
        <div class="room-intro-bottom"><ShieldCheck :size="14" /><span>已通过安全验证</span><span class="intro-bottom-separator">·</span><span>你的专属对话空间</span></div>
      </aside>

      <section class="chat-room" aria-label="在线会客厅" :style="content.settings.backgroundUrl ? {backgroundImage: `linear-gradient(rgba(253,253,249,.86), rgba(253,253,249,.9)), url(${JSON.stringify(content.settings.backgroundUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center'} : {}">
        <header class="chat-header">
          <div class="chat-avatar"><img :src="content.settings.avatarUrl || '/assets/avatar.svg'" alt="" @error="imageFallback" /></div>
          <div class="chat-header-copy"><h2>{{ brand }}<span>在线会客厅</span></h2><p><span class="tiny-dot"></span> 留言自动保存 · 回复会在这里更新</p></div>
          <button type="button" class="icon-button chat-help-button" aria-label="查看常见问题" @click="showHelp = true"><CircleHelp :size="21" /></button>
        </header>

        <div v-if="announcement && !noticeDismissed" class="announcement"><Megaphone :size="15" /><p>{{ announcement }}</p><button type="button" class="icon-button" aria-label="关闭公告" @click="noticeDismissed = true"><X :size="15" /></button></div>

        <div ref="scroller" class="chat-scroll" tabindex="0" aria-label="对话内容" @scroll="onScroll">
          <div class="date-divider"><span></span>{{ today }}<span></span></div>
          <div class="conversation-begin"><ShieldCheck :size="12" /> 验证已完成，欢迎开启对话</div>
          <div v-if="content.settings.welcomeMessage" class="message-group assistant-message">
            <img class="message-avatar" :src="content.settings.avatarUrl || '/assets/avatar.svg'" alt="" @error="imageFallback" />
            <div class="message-main"><span class="message-author">{{ brand }} · 服务助手</span><div class="message-bubble welcome-bubble"><span class="welcome-wave">HELLO, NICE TO MEET YOU</span><p>{{ content.settings.welcomeMessage }}</p></div></div>
          </div>

          <div v-for="block in blocks" :key="block.id" class="message-group assistant-message content-message">
            <div class="message-avatar-spacer"></div>
            <article class="content-card" :class="`content-card-${block.type}`">
              <img v-if="block.type === 'image' && block.imageUrl" class="content-card-image" :src="block.imageUrl" :alt="block.title || '服务介绍图片'" loading="lazy" />
              <div class="content-card-copy"><span v-if="block.type === 'image'" class="content-card-eyebrow"><Sparkles :size="12" /> MOMENTS OF GOOD</span><h3 v-if="block.title">{{ block.title }}</h3><p v-if="block.content">{{ block.content }}</p><a v-if="block.type === 'link' && safeLink(block.url)" :href="safeLink(block.url)" target="_blank" rel="noopener noreferrer" class="content-link">{{ block.buttonText || '了解更多' }}<ExternalLink :size="15" /></a></div>
            </article>
          </div>

          <div v-if="faqs.length" class="faq-section"><div class="faq-heading"><CircleHelp :size="14" /><span>也许，你想先了解</span></div><div class="faq-list"><button v-for="faq in faqs" :key="faq.id" class="faq-chip" type="button" :disabled="sending" @click="send(faq.question)">{{ faq.question }}<ChevronRight :size="14" /></button></div></div>

          <div v-for="message in visibleMessages" :key="message.id" class="message-group" :class="message.role === 'visitor' ? 'visitor-message' : 'assistant-message'">
            <img v-if="message.role !== 'visitor'" class="message-avatar" :src="content.settings.avatarUrl || '/assets/avatar.svg'" alt="" @error="imageFallback" />
            <div class="message-main"><span class="message-author">{{ message.role === 'visitor' ? '你' : `${brand} · ${message.role === 'admin' ? '客服回复' : '服务助手'}` }}<time :datetime="message.createdAt">{{ time(message.createdAt) }}</time></span><div class="message-bubble"><p>{{ message.content }}</p></div><span v-if="message.role === 'visitor'" class="message-sent"><Check :size="11" /> 已发送</span></div>
          </div>
          <div v-if="sending" class="sending-indicator"><span></span><span></span><span></span><span class="sr-only">正在发送消息</span></div>
          <div class="chat-scroll-end"></div>
        </div>

        <button v-if="showScrollBottom" class="scroll-bottom" type="button" @click="scrollBottom()"><ArrowDown :size="16" /> 回到最新消息</button>

        <footer class="composer-area">
          <div v-if="sendError" class="send-error" role="alert">{{ sendError }}<button type="button" class="icon-button" aria-label="关闭错误提示" @click="sendError = ''"><X :size="14" /></button></div>
          <form class="composer-form" @submit.prevent="send()"><textarea ref="composer" v-model="text" rows="1" maxlength="2000" :placeholder="content.settings.contactHint || '写下你的问题…'" aria-label="咨询消息" @input="resizeComposer" @keydown="onComposerKeydown" @compositionstart="composing = true" @compositionend="composing = false"></textarea><button class="send-button" type="submit" :disabled="!text.trim() || sending" aria-label="发送消息"><LoaderCircle v-if="sending" :size="19" class="spinning" /><Send v-else :size="18" /><span>发送</span></button></form>
          <div class="composer-footer"><span><LockKeyhole :size="11" /> 请勿发送密码、验证码等敏感信息</span><span class="composer-key-tip">Enter 发送 · Shift + Enter 换行</span></div>
        </footer>
      </section>
    </main>

    <footer class="site-footer"><span>© {{ new Date().getFullYear() }} {{ brand }}. 认真对待每一次相遇。</span><span><Leaf :size="12" /> 真诚，自有回响</span></footer>
    <div class="sr-only" aria-live="polite">{{ liveNotice }}</div>

    <div v-if="showHelp" class="dialog-backdrop" @click.self="showHelp = false" @keydown.esc="showHelp = false">
      <section ref="helpDialog" class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1"><div class="dialog-heading"><span class="eyebrow">HERE TO HELP</span><button type="button" class="icon-button" aria-label="关闭帮助" autofocus @click="showHelp = false"><X :size="20" /></button></div><h2 id="help-title">有什么可以帮你？</h2><p>关于访问和咨询，这里有一些小提示。</p><template v-if="content"><button v-for="faq in faqs" :key="faq.id" class="help-question" type="button" :disabled="sending" @click="send(faq.question)"><span>{{ faq.question }}</span><ArrowRight :size="17" /></button><div class="help-note"><MessageCircle :size="18" /><span>也可以直接在输入框留言，客服回复会在当前页面自动更新。</span></div></template><template v-else><div class="help-answer"><ShieldCheck :size="20" /><div><h3>如何完成验证？</h3><p>拖动图片下方的滑块，将小拼图移至图片中的缺口，松开后即可验证。键盘用户可以使用方向键调整，按回车提交。</p></div></div><div class="help-answer"><RefreshCw :size="20" /><div><h3>验证图片无法加载？</h3><p>点击验证区域右上角的刷新按钮，或检查网络后重新加载页面。无需注册或提交个人信息。</p></div></div></template><button class="dialog-close" type="button" @click="showHelp = false"><ArrowLeft :size="16" /> 返回{{ content ? '会客厅' : '安全验证' }}</button></section>
    </div>
  </div>
</template>
