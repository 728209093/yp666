<script setup lang="ts">
import {computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref} from 'vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import {ArrowRight, ArrowUpRight, Bell, ChevronDown, CircleHelp, ExternalLink, LayoutDashboard, Leaf, LogOut, Menu, MessageCircle, PanelTop, Settings2, ShieldCheck, Sparkles, X} from 'lucide-vue-next';
import {api} from './api';
import {publicSiteUrl} from './utils';
const Dashboard = defineAsyncComponent(() => import('./components/Dashboard.vue'));
const ContentEditor = defineAsyncComponent(() => import('./components/ContentEditor.vue'));
const Conversations = defineAsyncComponent(() => import('./components/Conversations.vue'));
const Security = defineAsyncComponent(() => import('./components/Security.vue'));

type Section = 'overview' | 'content' | 'settings' | 'faq' | 'messages' | 'security';
const nav = [
  {id: 'overview' as Section, label: '工作台概览', icon: LayoutDashboard},
  {id: 'content' as Section, label: '内容管理', icon: PanelTop},
  {id: 'settings' as Section, label: '页面设置', icon: Settings2},
  {id: 'faq' as Section, label: '常见问题', icon: CircleHelp},
  {id: 'messages' as Section, label: '访客咨询', icon: MessageCircle},
];
const active = ref<Section>('overview');
const menuOpen = ref(false);
const initializing = ref(true);
const authenticated = ref(false);
const username = ref('');
const login = ref({username: 'admin', password: ''});
const loggingIn = ref(false);
const loginError = ref('');
const dirty = ref(false);
const page = computed(() => [...nav, {id: 'security', label: '账户安全'}].find(i => i.id === active.value)?.label || '工作台概览');
const editorSection = computed(() => ['content', 'settings', 'faq'].includes(active.value));

function syncHash() {
  const value = window.location.hash.replace('#', '') as Section;
  active.value = ['overview', 'content', 'settings', 'faq', 'messages', 'security'].includes(value) ? value : 'overview';
}
function navigate(section: string) {window.location.hash = section; active.value = section as Section; menuOpen.value = false;}
function unauthorized() {authenticated.value = false; username.value = '';}
async function signIn() {
  loginError.value = '';
  if (!login.value.username.trim() || !login.value.password) {loginError.value = '请输入管理员账号和密码'; return;}
  loggingIn.value = true;
  try {
    const user = await api<{username: string}>('/admin/auth/login', {method: 'POST', body: JSON.stringify(login.value)});
    authenticated.value = true; username.value = user.username; login.value.password = ''; syncHash();
  } catch (error) {loginError.value = (error as Error).message;} finally {loggingIn.value = false;}
}
async function signOut() {
  try {
    if (dirty.value) await ElMessageBox.confirm('当前草稿有尚未保存的修改，退出后将丢失。确定退出吗？', '退出管理后台', {confirmButtonText: '退出登录', cancelButtonText: '继续编辑', type: 'warning'});
    await api('/admin/auth/logout', {method: 'POST'}); authenticated.value = false; dirty.value = false; username.value = ''; ElMessage.success('已安全退出');
  } catch (error) {if (error instanceof Error) ElMessage.error(error.message);}
}
onMounted(async () => {
  syncHash(); window.addEventListener('hashchange', syncHash); window.addEventListener('admin:unauthorized', unauthorized);
  try {const user = await api<{username: string}>('/admin/auth/me'); authenticated.value = true; username.value = user.username;} catch {authenticated.value = false;} finally {initializing.value = false;}
});
onBeforeUnmount(() => {window.removeEventListener('hashchange', syncHash); window.removeEventListener('admin:unauthorized', unauthorized);});
</script>

<template>
  <div v-if="initializing" class="initial-loader"><Leaf :size="34"/><p>正在打开管理工作台…</p></div>
  <div v-else-if="!authenticated" class="login-shell">
    <section class="login-story">
      <a class="login-brand" :href="publicSiteUrl" target="_blank" rel="noopener"><span class="brand-mark"><Leaf :size="25"/></span><strong>青屿<span>QINGYU</span></strong></a>
      <div class="login-story-copy"><span class="eyebrow">A LITTLE CARE, A BETTER CONNECTION</span><h1>每一份用心，<br/>都会被看见。</h1><p>让内容传递温度，让每一次回应<br/>都成为更好连接的开始。</p></div>
      <div class="login-landscape"><div class="landscape-sun"></div><div class="landscape-hill hill-one"></div><div class="landscape-hill hill-two"></div><div class="landscape-line"></div><Leaf class="landscape-leaf" :size="100" :stroke-width="0.6"/></div>
      <div class="login-story-footer"><span>青屿 · 在线会客厅</span><span>以真诚，连接每一次相遇。</span></div>
    </section>
    <section class="login-form-area">
      <div class="login-card"><div class="login-admin-badge"><ShieldCheck :size="15"/>管理工作台</div><h2>欢迎回来</h2><p class="muted">登录账号，开始照顾你的每一位访客。</p>
        <form @submit.prevent="signIn" class="login-form">
          <label for="login-username">管理员账号</label><el-input id="login-username" v-model="login.username" size="large" placeholder="请输入管理员账号" autocomplete="username" maxlength="80"/>
          <label for="login-password">登录密码</label><el-input id="login-password" v-model="login.password" size="large" type="password" show-password placeholder="请输入密码" autocomplete="current-password" maxlength="200"/>
          <p v-if="loginError" class="form-error" role="alert">{{loginError}}</p>
          <el-button type="primary" size="large" native-type="submit" :loading="loggingIn" class="login-submit">进入工作台<ArrowRight :size="17"/></el-button>
        </form>
        <div class="login-note"><ShieldCheck :size="15"/><span>仅限授权管理员访问</span></div>
      </div>
      <footer class="login-footer">青屿管理平台 · 用心经营每一段连接</footer>
    </section>
  </div>
  <div v-else class="admin-layout">
    <div v-if="menuOpen" class="sidebar-mask" @click="menuOpen = false"></div>
    <aside class="sidebar" :class="{'is-open': menuOpen}">
      <div class="sidebar-brand"><span class="brand-mark"><Leaf :size="23"/></span><div><strong>青屿</strong><span>管理工作台</span></div><button class="icon-btn mobile-close" aria-label="关闭菜单" @click="menuOpen = false"><X :size="20"/></button></div>
      <div class="sidebar-label">WORKSPACE</div>
      <nav class="sidebar-nav" aria-label="管理菜单"><button v-for="item in nav" :key="item.id" :class="{active: active === item.id}" @click="navigate(item.id)"><component :is="item.icon" :size="18"/><span>{{item.label}}</span><span v-if="['content', 'settings', 'faq'].includes(item.id) && dirty" class="draft-dot" aria-label="有未保存修改"></span></button></nav>
      <div class="sidebar-site-card"><Sparkles :size="20"/><strong>你的会客厅，已准备就绪</strong><p>看看访客眼中的青屿。</p><a :href="publicSiteUrl" target="_blank" rel="noopener">打开前台<ArrowUpRight :size="16"/></a></div>
      <div class="sidebar-bottom"><button :class="{active: active === 'security'}" @click="navigate('security')"><ShieldCheck :size="18"/>账户安全</button><button @click="signOut"><LogOut :size="18"/>退出登录</button><div class="sidebar-copyright">青屿 QINGYU <span>·</span> 用心连接</div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" aria-label="展开菜单" @click="menuOpen = true"><Menu :size="22"/></button><span class="breadcrumb-home">工作空间</span><span class="breadcrumb-slash">/</span><strong>{{page}}</strong></div><div class="topbar-right"><a :href="publicSiteUrl" target="_blank" rel="noopener" class="header-preview"><ExternalLink :size="15"/><span>预览网站</span></a><span class="topbar-divider"></span><div class="admin-avatar">{{username.charAt(0).toUpperCase()}}</div><span class="admin-name">{{username}}</span><ChevronDown :size="14" class="muted"/></div></header>
      <main class="main-content">
        <Dashboard v-if="active === 'overview'" @navigate="navigate"/>
        <ContentEditor v-show="editorSection" :section="active" @dirty="dirty = $event"/>
        <Conversations v-if="active === 'messages'"/>
        <Security v-if="active === 'security'" :username="username"/>
      </main>
      <footer class="workspace-footer"><span>青屿 · 每一次连接，都值得用心。</span><span class="footer-status"><i></i>本地工作空间</span></footer>
    </div>
  </div>
</template>
