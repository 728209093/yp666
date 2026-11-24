<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {ArrowLeft, CheckCheck, ChevronRight, Leaf, MessageCircle, RefreshCw, Search, Send, ShieldCheck} from 'lucide-vue-next';
import type {ChatMessage, ConversationDetail, ConversationSummary} from '@yp666/shared';
import {api} from '../api';
import {dateTime} from '../utils';
const conversations = ref<ConversationSummary[]>([]);
const selected = ref<ConversationDetail>();
const query = ref('');
const filter = ref<'all' | 'unread'>('all');
const loading = ref(true);
const detailLoading = ref(false);
const error = ref('');
const reply = ref('');
const sending = ref(false);
const messageList = ref<HTMLElement>();
let timer: ReturnType<typeof setInterval> | undefined;
let loadId = 0;
const filtered = computed(() => conversations.value.filter(row => (filter.value !== 'unread' || row.unreadCount > 0) && (!query.value.trim() || `${row.visitorLabel} ${row.lastMessage}`.toLowerCase().includes(query.value.trim().toLowerCase()))));
const unread = computed(() => conversations.value.filter(row => row.unreadCount > 0).length);
async function load(silent = false) {
  if (!silent) {loading.value = true; error.value = '';}
  try {conversations.value = await api<ConversationSummary[]>('/admin/conversations');} catch (e) {if (!silent) error.value = (e as Error).message;} finally {loading.value = false;}
}
async function open(row: ConversationSummary) {
  if (sending.value) return;
  const id = ++loadId;
  detailLoading.value = true; reply.value = '';
  try {const detail = await api<ConversationDetail>(`/admin/conversations/${encodeURIComponent(row.id)}`); if (id !== loadId) return; selected.value = detail; const found = conversations.value.find(v => v.id === row.id); if (found) found.unreadCount = 0; await scrollBottom();} catch (e) {ElMessage.error((e as Error).message);} finally {if (id === loadId) detailLoading.value = false;}
}
async function scrollBottom() {await nextTick(); if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;}
async function poll() {
  if (document.hidden || sending.value || detailLoading.value) return;
  await load(true);
  const id = selected.value?.conversation.id;
  if (!id) return;
  try {const detail = await api<ConversationDetail>(`/admin/conversations/${encodeURIComponent(id)}`); if (selected.value?.conversation.id !== id) return; const previous = selected.value.messages.at(-1)?.id; selected.value = detail; const row = conversations.value.find(v => v.id === id); if (row) row.unreadCount = 0; if (previous !== detail.messages.at(-1)?.id) await scrollBottom();} catch {}
}
async function send() {
  const content = reply.value.trim(); const id = selected.value?.conversation.id;
  if (!content || !id || sending.value) return;
  sending.value = true;
  try {const messages = await api<ChatMessage[]>(`/admin/conversations/${encodeURIComponent(id)}/messages`, {method: 'POST', body: JSON.stringify({content})}); if (selected.value?.conversation.id === id) {selected.value.messages = messages; reply.value = ''; await scrollBottom();} await load(true);} catch (e) {ElMessage.error((e as Error).message);} finally {sending.value = false;}
}
function onKey(event: KeyboardEvent) {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); void send();}}
function back() {++loadId; selected.value = undefined;}
onMounted(async () => {await load(); timer = setInterval(() => void poll(), 5000);});
onBeforeUnmount(() => {++loadId; if (timer) clearInterval(timer);});
</script>
<template>
  <section class="conversations-page"><div class="page-heading"><div><div class="eyebrow">A THOUGHTFUL REPLY MATTERS</div><h1>每个问题，都有回应<span class="heading-dot">.</span></h1><p>在这里查看访客留言，接住每一份期待。</p></div><el-button :loading="loading" @click="load()"><RefreshCw :size="15"/>刷新会话</el-button></div><div v-if="error" class="error-panel"><p>{{error}}</p><el-button @click="load()">重新加载</el-button></div><div v-else class="conversation-workspace panel" :class="{'has-selected': selected}"><aside class="conversation-sidebar" v-loading="loading"><div class="conversation-list-title"><h2>访客会话 <span>{{conversations.length}}</span></h2><span v-if="unread" class="unread-label">{{unread}} 待查看</span></div><div class="conversation-search"><Search :size="15"/><input v-model="query" placeholder="搜索访客或留言内容" aria-label="搜索访客或留言内容"/></div><div class="conversation-tabs"><button :class="{active: filter === 'all'}" @click="filter = 'all'">全部会话</button><button :class="{active: filter === 'unread'}" @click="filter = 'unread'">待查看 <span>{{unread}}</span></button></div><div class="conversation-list"><div v-if="!filtered.length" class="empty-small"><MessageCircle :size="30"/><p>{{query ? '没有找到匹配的会话' : filter === 'unread' ? '所有留言都已查看' : '还没有访客留言'}}</p><small>{{query ? '试试其他搜索词' : '新的咨询会自动出现在这里'}}</small></div><button v-for="row in filtered" :key="row.id" class="conversation-row" :class="{active: selected?.conversation.id === row.id}" @click="open(row)"><span class="visitor-avatar">{{row.visitorLabel.slice(-2)}}</span><div class="conversation-row-content"><div><strong>{{row.visitorLabel}}</strong><time>{{dateTime(row.updatedAt)}}</time></div><p>{{row.lastMessage || '新会话'}}</p></div><span v-if="row.unreadCount" class="unread-count">{{row.unreadCount > 99 ? '99+' : row.unreadCount}}</span></button></div></aside><section class="conversation-detail" v-loading="detailLoading"><template v-if="selected"><header class="conversation-detail-header"><button class="icon-btn conversation-back" aria-label="返回会话列表" @click="back"><ArrowLeft :size="18"/></button><span class="visitor-avatar">{{selected.conversation.visitorLabel.slice(-2)}}</span><div><h3>{{selected.conversation.visitorLabel}}</h3><p>首次留言 {{dateTime(selected.conversation.createdAt)}}</p></div><span class="private-label"><ShieldCheck :size="13"/>私密会话</span></header><div ref="messageList" class="admin-messages"><div class="message-start">会话开始于 {{dateTime(selected.conversation.createdAt)}}</div><div v-for="message in selected.messages" :key="message.id" class="admin-message" :class="{outgoing: message.role === 'admin', automatic: message.role === 'assistant'}"><div class="message-role">{{message.role === 'admin' ? '管理员' : message.role === 'assistant' ? '服务助手 · 自动回复' : selected.conversation.visitorLabel}}<time>{{dateTime(message.createdAt)}}</time></div><div class="admin-message-bubble">{{message.content}}</div></div></div><form class="admin-reply" @submit.prevent="send"><div class="reply-label"><MessageCircle :size="14"/>回复访客<span>回复会自动同步到访客页面</span></div><textarea v-model="reply" :disabled="sending" placeholder="写下你的回复…" maxlength="2000" aria-label="回复内容" @keydown="onKey"></textarea><div class="reply-footer"><span>Enter 发送 · Shift + Enter 换行</span><el-button type="primary" native-type="submit" :loading="sending" :disabled="!reply.trim()"><Send :size="14"/>发送回复</el-button></div></form></template><div v-else class="conversation-empty"><span class="conversation-empty-icon"><MessageCircle :size="38" :stroke-width="1.1"/></span><h3>一份认真回复，从这里开始</h3><p>选择左侧会话，查看访客的问题。<br/>你的回应，将被及时传达。</p><span class="empty-security"><ShieldCheck :size="13"/>仅管理员与对应访客可查看</span></div></section></div></section>
</template>
