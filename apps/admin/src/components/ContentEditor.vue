<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import {ArrowDown, ArrowUp, Check, ChevronRight, CircleHelp, Eye, FileText, Image, Leaf, Link, Megaphone, Plus, RefreshCw, Save, Send, Settings2, ShieldCheck, Trash2, Video} from 'lucide-vue-next';
import {defaultDocument, siteDocumentSchema, type AdminContentResponse, type ContentBlock, type SiteDocument} from '@yp666/shared';
import {api} from '../api';
import {assetUrl, dateTime} from '../utils';
import {createContentId} from '../content-id';
import ImageInput from './ImageInput.vue';
import MediaPreview from './MediaPreview.vue';
import VideoInput from './VideoInput.vue';
import RichTextEditor from './RichTextEditor.vue';
import {plainToRichText, richTextPlain, safeRichText} from '../richtext';
const props = defineProps<{section: string}>();
const emit = defineEmits<{(e: 'dirty', value: boolean): void}>();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const draft = ref<SiteDocument>(clone(defaultDocument));
const published = ref<SiteDocument>(clone(defaultDocument));
const baseline = ref('');
const publishedAt = ref<string | null>(null);
const loading = ref(true);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);
const previewOpen = ref(false);
const imagePreview = ref('');
const expanded = ref<string>('');
const dirty = computed(() => loaded.value && JSON.stringify(draft.value) !== baseline.value);
const unpublished = computed(() => JSON.stringify(draft.value) !== JSON.stringify(published.value));
const sectionText = computed(() => props.section === 'settings' ? {eyebrow: 'MAKE IT YOUR OWN', title: '布置你的会客厅', text: '把品牌的温度，藏进每一个细节里。'} : props.section === 'faq' ? {eyebrow: 'HELP, BEFORE THEY ASK', title: '把答案，提前准备好', text: '访客点击问题后，服务助手会自动回复对应答案。'} : {eyebrow: 'WORDS THAT CONNECT', title: '用内容，开启对话', text: '在这里编辑访客将看到的图文与链接。保存后发布，即可更新前台。'});
watch(dirty, value => emit('dirty', value));
function apply(data: AdminContentResponse) {draft.value = siteDocumentSchema.parse(clone(data.draft)); published.value = siteDocumentSchema.parse(clone(data.published)); publishedAt.value = data.publishedAt; baseline.value = JSON.stringify(draft.value); loaded.value = true;}
async function load() {loading.value = true; error.value = ''; try {apply(await api<AdminContentResponse>('/admin/content'));} catch (e) {error.value = (e as Error).message;} finally {loading.value = false;}}
async function refresh() {try {if (dirty.value) await ElMessageBox.confirm('重新加载会丢失尚未保存的修改。确定继续吗？', '重新加载', {type: 'warning', confirmButtonText: '重新加载', cancelButtonText: '继续编辑'}); await load();} catch {}}
function validate() {
  const result = siteDocumentSchema.safeParse(draft.value);
  if (!result.success) {const issue = result.error.issues[0]; ElMessage.warning(`请检查配置：${issue?.message || '填写内容不完整'}（${issue?.path.join('.') || ''}）`); return false;}
  const emptyImage = draft.value.blocks.find(block => block.enabled && block.type === 'image' && !block.imageUrl);
  if (emptyImage) {expanded.value = emptyImage.id; ElMessage.warning('请为已启用的图片模块选择图片，或暂时关闭该模块'); return false;}
  const emptyVideo = draft.value.blocks.find(block => block.enabled && block.type === 'video' && !block.videoUrl);
  if (emptyVideo) {expanded.value = emptyVideo.id; ElMessage.warning('请为已启用的视频模块选择视频，或暂时关闭该模块'); return false;}
  const emptyLink = draft.value.blocks.find(block => block.enabled && block.type === 'link' && !/^https?:\/\//i.test(block.url));
  if (emptyLink) {expanded.value = emptyLink.id; ElMessage.warning('请为已启用的链接模块填写完整的 http(s) 链接'); return false;}
  return true;
}
async function save() {if (!validate()) return; busy.value = true; try {apply(await api<AdminContentResponse>('/admin/content', {method: 'PUT', body: JSON.stringify({document: draft.value})})); ElMessage.success('草稿已保存，发布后前台生效');} catch (e) {ElMessage.error((e as Error).message);} finally {busy.value = false;}}
async function publish() {
  if (!validate()) return;
  try {await ElMessageBox.confirm('发布后，访客将看到当前的页面设置、内容和常见问题。', '发布当前版本', {confirmButtonText: '确认发布', cancelButtonText: '再检查一下', type: 'info'});} catch {return;}
  busy.value = true;
  try {if (dirty.value) apply(await api<AdminContentResponse>('/admin/content', {method: 'PUT', body: JSON.stringify({document: draft.value})})); apply(await api<AdminContentResponse>('/admin/content/publish', {method: 'POST'})); ElMessage.success('发布成功，前台内容已更新');} catch (e) {ElMessage.error((e as Error).message);} finally {busy.value = false;}
}
function addBlock(type: ContentBlock['type']) {const block: ContentBlock = {id: createContentId(), type, title: '', content: '', contentFormat: 'richtext', imageUrl: '', videoUrl: '', buttonText: type === 'link' ? '了解更多' : '', url: '', enabled: true, sortOrder: draft.value.blocks.length}; draft.value.blocks.push(block); expanded.value = block.id;}
function editContent(block: ContentBlock, value: string) {block.content = value; block.contentFormat = 'richtext';}
function editorContent(block: ContentBlock) {return block.contentFormat === 'richtext' ? block.content : plainToRichText(block.content);}
function move(index: number, offset: number) {const target = index + offset; if (target < 0 || target >= draft.value.blocks.length) return; [draft.value.blocks[index], draft.value.blocks[target]] = [draft.value.blocks[target]!, draft.value.blocks[index]!]; draft.value.blocks.forEach((block, i) => block.sortOrder = i);}
async function removeBlock(id: string) {try {await ElMessageBox.confirm('删除后保存并发布，前台将不再展示此模块。', '删除内容模块', {confirmButtonText: '删除', cancelButtonText: '保留', type: 'warning'}); draft.value.blocks = draft.value.blocks.filter(block => block.id !== id); draft.value.blocks.forEach((block, i) => block.sortOrder = i);} catch {}}
function addFaq() {draft.value.faqs.push({id: createContentId(), question: '', answer: '', enabled: true});}
function removeFaq(id: string) {draft.value.faqs = draft.value.faqs.filter(faq => faq.id !== id);}
function beforeUnload(event: BeforeUnloadEvent) {if (dirty.value) {event.preventDefault(); event.returnValue = '';}}
onMounted(() => {void load(); window.addEventListener('beforeunload', beforeUnload);});
onBeforeUnmount(() => {window.removeEventListener('beforeunload', beforeUnload); emit('dirty', false);});
</script>
<template>
  <section class="editor-page" v-loading="loading">
    <div class="page-heading">
<div>
<div class="eyebrow">{{sectionText.eyebrow}}</div>
<h1>{{sectionText.title}}<span class="heading-dot">.</span>
</h1>
<p>{{sectionText.text}}</p>
</div>
<div class="heading-actions">
<el-button :disabled="!loaded" @click="previewOpen = true">
<Eye :size="15"/>预览草稿</el-button>
</div>
</div>
    <div v-if="error" class="error-panel">
<p>{{error}}</p>
<el-button @click="load">重新加载</el-button>
</div>
    <template v-else-if="loaded">
      <div class="editor-status">
<div>
<span class="status-dot" :class="{pending: dirty || unpublished}">
</span>
<strong>{{dirty ? '有未保存的修改' : unpublished ? '草稿已保存，等待发布' : '当前内容已发布'}}</strong>
<span class="status-caption">上次发布：{{dateTime(publishedAt)}}</span>
</div>
<button class="text-link" :disabled="busy" @click="refresh">
<RefreshCw :size="13"/>重新加载</button>
</div>
      <div v-if="section === 'content'" class="editor-grid">
        <div class="editor-main">
<div class="section-label">
<h2>内容模块 <span class="count-pill">{{draft.blocks.length}}</span>
</h2>
<span>按照下方顺序展示</span>
</div>
<div v-if="!draft.blocks.length" class="panel empty-state">
<FileText :size="38"/>
<h3>给会客厅添加第一段内容</h3>
<p>从一段欢迎文字，或一张喜欢的图片开始。</p>
<el-button type="primary" @click="addBlock('text')">
<Plus :size="15"/>添加文字模块</el-button>
</div>
          <article v-for="(block, index) in draft.blocks" :key="block.id" class="panel block-card" :class="{'block-disabled': !block.enabled}">
<div class="block-top">
<button class="block-title" @click="expanded = expanded === block.id ? '' : block.id">
<span class="block-type-icon">
<component :is="block.type === 'image' ? Image : block.type === 'video' ? Video : block.type === 'link' ? Link : FileText" :size="18"/>
</span>
<div>
<strong>{{block.title || (block.type === 'image' ? '图片模块' : block.type === 'video' ? '视频模块' : block.type === 'link' ? '链接模块' : '文字模块')}}</strong>
<small>{{block.type === 'image' ? '图片内容' : block.type === 'video' ? '视频内容' : block.type === 'link' ? '跳转链接' : '富文本'}}<span>·</span>模块 {{String(index + 1).padStart(2, '0')}}</small>
</div>
<ChevronRight :size="16" :class="{expanded: expanded === block.id}"/>
</button>
<div class="block-actions">
<el-switch v-model="block.enabled" :aria-label="`展示模块 ${index + 1}`"/>
<button class="icon-btn" :disabled="index === 0" aria-label="向上移动" @click="move(index, -1)">
<ArrowUp :size="15"/>
</button>
<button class="icon-btn" :disabled="index === draft.blocks.length - 1" aria-label="向下移动" @click="move(index, 1)">
<ArrowDown :size="15"/>
</button>
<button class="icon-btn danger-hover" aria-label="删除模块" @click="removeBlock(block.id)">
<Trash2 :size="15"/>
</button>
</div>
</div>
<div v-show="expanded === block.id" class="block-form">
<el-form label-position="top">
<el-form-item label="模块标题">
<el-input v-model="block.title" maxlength="100" show-word-limit placeholder="给这一段内容起个标题"/>
</el-form-item>
<el-form-item :label="block.type === 'image' ? '图片说明' : '正文内容'">
<RichTextEditor :model-value="editorContent(block)" label="正文内容" :send-on-enter="false" @update:model-value="editContent(block, $event)"/>
</el-form-item>
<el-form-item v-if="block.type === 'image'" label="展示图片">
<ImageInput v-model="block.imageUrl" label="图片 URL，或点击上传图片"/>
</el-form-item>
<el-form-item v-if="block.type === 'video'" label="展示视频"><VideoInput v-model="block.videoUrl"/></el-form-item>
<div v-if="block.type === 'link'">
<el-form-item label="按钮文字">
<el-input v-model="block.buttonText" maxlength="40" placeholder="例如：了解更多"/>
</el-form-item>
<el-form-item label="跳转链接">
<el-input v-model="block.url" maxlength="2000" placeholder="请输入完整的 HTTPS 链接"/>
</el-form-item>
<p class="field-hint">仅支持 http / https 链接，将在新标签页打开。</p>
</div>
</el-form>
</div>
<div v-if="expanded !== block.id && block.content" class="block-summary">{{block.contentFormat === 'richtext' ? richTextPlain(block.content) : block.content}}</div>
</article>
          <div class="add-block-bar">
<span>添加内容</span>
<el-button @click="addBlock('text')">
<FileText :size="15"/>文字</el-button>
<el-button @click="addBlock('image')">
<Image :size="15"/>图片</el-button>
<el-button @click="addBlock('video')"><Video :size="15"/>视频</el-button>
<el-button @click="addBlock('link')">
<Link :size="15"/>链接按钮</el-button>
</div>
        </div>
<aside class="editor-side">
<div class="panel tip-card">
<span class="tip-icon">
<Leaf :size="22"/>
</span>
<h3>让表达，简单一点</h3>
<p>一段简洁的文字，一张恰到好处的图片，就能让访客多了解你一点。</p>
<ul>
<li>使用短段落，手机阅读更轻松</li>
<li>图片按原始比例完整展示</li>
<li>通过开关可暂时隐藏模块</li>
<li>保存草稿不会立即影响前台</li>
</ul>
</div>
<div class="editor-side-note">
<ShieldCheck :size="17"/>
<p>前台仅展示已发布的内容。<br/>预览确认后，再点击发布。</p>
</div>
</aside>
      </div>
      <div v-else-if="section === 'settings'" class="settings-layout">
<div class="settings-panels">
<article class="panel settings-panel">
<div class="panel-heading">
<div>
<h2>品牌与页面</h2>
<p>访客对会客厅的第一印象</p>
</div>
<Settings2 :size="19" class="muted"/>
</div>
<el-form label-position="top">
<div class="form-two">
<el-form-item label="品牌名称">
<el-input v-model="draft.settings.brandName" maxlength="30" show-word-limit/>
</el-form-item>
<el-form-item label="主题颜色">
<div class="color-field">
<el-color-picker v-model="draft.settings.primaryColor"/>
<el-input v-model="draft.settings.primaryColor" maxlength="7"/>
</div>
</el-form-item>
</div>
<el-form-item label="页面主标题">
<el-input v-model="draft.settings.title" maxlength="60" show-word-limit/>
</el-form-item>
<el-form-item label="页面副标题">
<el-input v-model="draft.settings.subtitle" type="textarea" :rows="3" maxlength="160" show-word-limit/>
</el-form-item>
<el-form-item label="品牌头像">
<ImageInput v-model="draft.settings.avatarUrl" label="头像图片 URL" round/>
</el-form-item>
<el-form-item label="客服头像形状">
<div class="avatar-shape-options" role="group" aria-label="客服头像形状">
<button v-for="shape in (['circle', 'rounded', 'square'] as const)" :key="shape" type="button" :class="{active: draft.settings.avatarShape === shape}" :aria-pressed="draft.settings.avatarShape === shape" @click="draft.settings.avatarShape = shape"><img :src="assetUrl(draft.settings.avatarUrl || '/assets/avatar.svg')" alt="" :class="`avatar-${shape}`"/><span>{{shape === 'circle' ? '圆形' : shape === 'rounded' ? '圆角' : '方角'}}</span></button>
</div>
</el-form-item>
<el-form-item label="安全验证背景图片">
<ImageInput v-model="draft.settings.verificationBackgroundUrl" label="验证页面背景图片，留空使用默认背景"/>
</el-form-item>
<el-form-item label="聊天窗口背景图片">
<ImageInput v-model="draft.settings.chatBackgroundUrl" label="聊天窗口背景图片，留空使用默认背景"/>
</el-form-item>
<el-form-item label="桌面介绍区背景图片（可选）">
<ImageInput v-model="draft.settings.backgroundUrl" label="介绍区背景图片，可留空"/>
</el-form-item>
<el-form-item label="浏览器标签页标题">
<el-input v-model="draft.settings.pageTitle" maxlength="80" show-word-limit placeholder="例如：在线客服"/>
<p class="field-hint">进入聊天窗口后的网页标题，发布后会自动同步。</p>
</el-form-item>
<el-form-item label="加载提示文字">
<el-input v-model="draft.settings.loadingText" maxlength="80" show-word-limit placeholder="正在加载，请稍候…"/>
<div class="loading-text-preview"><span></span>{{draft.settings.loadingText || '正在加载，请稍候…'}}</div>
</el-form-item>
</el-form>
</article>
        <article class="panel settings-panel">
<div class="panel-heading">
<div>
<h2>公告与欢迎语</h2>
<p>用一句问候，开启对话</p>
</div>
<FileText :size="19" class="muted"/>
</div>
<el-form label-position="top">
<el-form-item label="顶部公告">
<el-input v-model="draft.settings.announcement" type="textarea" :rows="2" maxlength="240" show-word-limit placeholder="留空则不展示公告"/>
</el-form-item>
<el-form-item label="公告滚动周期（秒）">
<el-input-number v-model="draft.settings.announcementSpeed" :min="10" :max="120" :step="2"/>
<span class="field-hint inline-hint">数值越大，滚动越慢</span>
</el-form-item>
<div v-if="draft.settings.announcement" class="announcement-preview"><Megaphone :size="16"/><div><span :style="{animationDuration: `${draft.settings.announcementSpeed}s`}">{{draft.settings.announcement}}</span></div></div>
<div class="setting-switch-row">
<div><strong>客服回复提示音</strong><p>访客允许声音后，收到客服新回复时播放短提示音。</p></div>
<el-switch v-model="draft.settings.notificationSound" aria-label="开启客服回复提示音"/>
</div>
<el-form-item label="介绍区标题">
<el-input v-model="draft.settings.introTitle" maxlength="80"/>
</el-form-item>
<el-form-item label="介绍区内容">
<el-input v-model="draft.settings.introText" type="textarea" :rows="3" maxlength="2000" show-word-limit/>
</el-form-item>
<el-form-item label="服务助手欢迎消息">
<el-input v-model="draft.settings.welcomeMessage" type="textarea" :rows="4" maxlength="1000" show-word-limit/>
</el-form-item>
<el-form-item label="输入区提示">
<el-input v-model="draft.settings.contactHint" maxlength="160"/>
</el-form-item>
</el-form>
</article>
        <article class="panel settings-panel">
<div class="panel-heading">
<div>
<h2>访客安全验证</h2>
<p>控制验证入口与会话有效期</p>
</div>
<ShieldCheck :size="19" class="muted"/>
</div>
<div class="setting-switch-row">
<div>
<strong>进入前完成验证</strong>
<p>开启后，访客通过安全验证才能读取页面内容。</p>
</div>
<el-switch v-model="draft.settings.verificationEnabled" aria-label="开启访客验证"/>
</div>
<el-form label-position="top">
<el-form-item label="验证有效时间（分钟）">
<el-input-number v-model="draft.settings.verificationTtlMinutes" :min="5" :max="1440" :step="5"/>
<span class="field-hint inline-hint">有效期内无需重复验证</span>
</el-form-item>
</el-form>
<div class="inline-info">
<ShieldCheck :size="16"/>
<p>验证方式由后端配置；当前页面仅管理开关和有效时间。修改后发布生效。</p>
</div>
</article>
</div>
<aside class="editor-side">
<div class="panel tip-card">
<span class="tip-icon">
<Settings2 :size="22"/>
</span>
<h3>一点细节，一点温度</h3>
<p>品牌名称、主题色和欢迎语，会同时应用到电脑端与手机端。</p>
<ul>
<li>头像推荐使用正方形图片</li>
<li>副标题支持换行</li>
<li>背景图片可留空</li>
<li>预览草稿可以检查排版</li>
</ul>
</div>
</aside>
</div>
      <div v-else-if="section === 'faq'" class="editor-grid">
<div class="editor-main">
<div class="section-label">
<h2>常见问题 <span class="count-pill">{{draft.faqs.length}}</span>
</h2>
<el-button @click="addFaq">
<Plus :size="15"/>添加问题</el-button>
</div>
<div v-if="!draft.faqs.length" class="panel empty-state">
<CircleHelp :size="38"/>
<h3>提前准备几个常见答案</h3>
<p>访客点击问题后，可以立即获得对应回复。</p>
<el-button type="primary" @click="addFaq">添加第一个问题</el-button>
</div>
<article v-for="(faq, index) in draft.faqs" :key="faq.id" class="panel faq-card">
<div class="faq-card-heading">
<span class="faq-number">Q{{String(index + 1).padStart(2, '0')}}</span>
<div class="block-actions">
<el-switch v-model="faq.enabled" :aria-label="`启用问题 ${index + 1}`"/>
<button class="icon-btn danger-hover" aria-label="删除问题" @click="removeFaq(faq.id)">
<Trash2 :size="15"/>
</button>
</div>
</div>
<el-form label-position="top">
<el-form-item label="访客会问的问题">
<el-input v-model="faq.question" placeholder="例如：怎样联系人工客服？" maxlength="160" show-word-limit/>
</el-form-item>
<el-form-item label="服务助手自动回复">
<el-input v-model="faq.answer" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="用简洁、清晰的语言回答这个问题"/>
</el-form-item>
</el-form>
</article>
</div>
<aside class="editor-side">
<div class="panel tip-card">
<span class="tip-icon">
<CircleHelp :size="22"/>
</span>
<h3>提前一步，帮到访客</h3>
<p>这些问题会以快捷入口展示。访客点击后，问题会作为留言发送，服务助手会回复你配置的答案。</p>
<ul>
<li>问题建议简短、口语化</li>
<li>答案尽量直接解决问题</li>
<li>关闭开关即可隐藏该问题</li>
</ul>
</div>
</aside>
</div>
      <div class="save-bar">
<div>
<Check v-if="!dirty" :size="16"/>
<span v-else class="status-dot pending">
</span>
<span>{{dirty ? '修改尚未保存' : '草稿已保存'}}</span>
<small>保存 → 预览 → 发布</small>
</div>
<div>
<el-button :loading="busy" :disabled="!dirty" @click="save">
<Save :size="15"/>保存草稿</el-button>
<el-button type="primary" :loading="busy" @click="publish">
<Send :size="15"/>发布到前台</el-button>
</div>
</div>
    </template>
    <el-dialog v-model="previewOpen" title="草稿预览" width="440px" class="draft-preview-dialog" align-center>
<p class="preview-hint">此预览展示草稿内容，尚未对访客发布。</p>
<div class="draft-phone" :style="{'--preview-color': draft.settings.primaryColor, backgroundImage: draft.settings.chatBackgroundUrl ? `url(${assetUrl(draft.settings.chatBackgroundUrl)})` : undefined}">
<div class="draft-notice announcement-preview" v-if="draft.settings.announcement"><Megaphone :size="14"/><div><span :style="{animationDuration: `${draft.settings.announcementSpeed}s`}">{{draft.settings.announcement}}</span></div></div>
<div class="draft-phone-body">
<div class="draft-intro">
<span>HELLO, NICE TO MEET YOU</span>
<h3>{{draft.settings.introTitle}}</h3>
<p>{{draft.settings.introText}}</p>
</div>
<div class="preview-message-row"><img :src="assetUrl(draft.settings.avatarUrl || '/assets/avatar.svg')" alt="客服头像" :class="`avatar-${draft.settings.avatarShape}`"/><div class="preview-bubble">{{draft.settings.welcomeMessage}}</div></div>
<article v-for="block in draft.blocks.filter(b => b.enabled)" :key="block.id" class="preview-block">
<button v-if="block.type === 'image' && block.imageUrl" type="button" class="preview-block-image" aria-label="查看草稿图片大图" @click="imagePreview = assetUrl(block.imageUrl)"><img :src="assetUrl(block.imageUrl)" :alt="block.title"/></button>
<video v-if="block.type === 'video' && block.videoUrl" class="preview-block-video" :src="assetUrl(block.videoUrl)" controls playsinline preload="metadata" :aria-label="block.title || '内容视频预览'"></video>
<h4 v-if="block.title">{{block.title}}</h4>
<div v-if="block.contentFormat === 'richtext'" class="safe-richtext" v-html="safeRichText(block.content)"></div><p v-else>{{block.content}}</p>
<span v-if="block.type === 'link'" class="preview-link">{{block.buttonText || '了解更多'}}<ChevronRight :size="13"/>
</span>
</article>
<div class="preview-faq">
<span v-for="faq in draft.faqs.filter(f => f.enabled)" :key="faq.id">{{faq.question}}</span>
</div>
</div>
<div class="draft-composer">{{draft.settings.contactHint}}</div>
</div>
</el-dialog>
<MediaPreview :src="imagePreview" @close="imagePreview = ''"/>
  </section>
</template>
