<script setup lang="ts">
import {reactive, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {KeyRound, ShieldCheck, UserRound} from 'lucide-vue-next';
import {api} from '../api';
defineProps<{username: string}>();
const form = reactive({currentPassword: '', newPassword: '', confirmation: ''});
const busy = ref(false);
const error = ref('');
async function save() {
  error.value = '';
  if (!form.currentPassword || !form.newPassword) {error.value = '请填写当前密码与新密码'; return;}
  if (form.newPassword.length < 12 || new TextEncoder().encode(form.newPassword).length > 72) {error.value = '新密码至少 12 个字符，最多 72 字节；中文和表情会占用多个字节'; return;}
  if (form.newPassword !== form.confirmation) {error.value = '两次输入的新密码不一致'; return;}
  busy.value = true;
  try {await api('/admin/auth/password', {method: 'POST', body: JSON.stringify({currentPassword: form.currentPassword, newPassword: form.newPassword})}); form.currentPassword = ''; form.newPassword = ''; form.confirmation = ''; ElMessage.success('密码已更新，请使用新密码重新登录'); window.dispatchEvent(new Event('admin:unauthorized'));} catch (e) {error.value = (e as Error).message;} finally {busy.value = false;}
}
</script>
<template><section><div class="page-heading"><div><div class="eyebrow">KEEP YOUR WORKSPACE SAFE</div><h1>让用心，有一份保障<span class="heading-dot">.</span></h1><p>管理你的登录凭据，保护会客厅里的每一段连接。</p></div></div><div class="security-grid"><article class="panel settings-panel"><div class="panel-heading"><div><h2>修改登录密码</h2><p>建议使用 12–72 位英文、数字和符号；中文和表情会占用多个字节</p></div><KeyRound :size="21" class="muted"/></div><div class="account-info"><span class="account-info-icon"><UserRound :size="21"/></span><div><small>当前管理员</small><strong>{{username}}</strong></div><span class="soft-badge">管理员</span></div><form @submit.prevent="save"><el-form label-position="top"><el-form-item label="当前密码"><el-input v-model="form.currentPassword" type="password" show-password autocomplete="current-password" maxlength="128" placeholder="输入当前登录密码"/></el-form-item><el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" minlength="12" maxlength="72" placeholder="至少 12 个字符"/></el-form-item><el-form-item label="再次输入新密码"><el-input v-model="form.confirmation" type="password" show-password autocomplete="new-password" maxlength="72" placeholder="再次输入以确认"/></el-form-item></el-form><p v-if="error" role="alert" class="form-error">{{error}}</p><el-button type="primary" native-type="submit" :loading="busy"><ShieldCheck :size="15"/>更新密码</el-button></form></article><aside class="panel tip-card security-tip"><span class="tip-icon"><ShieldCheck :size="23"/></span><h3>好习惯，让安全更简单</h3><p>密码仅用于管理后台登录，不会向访客展示。</p><ul><li>建议包含大小写字母、数字和符号</li><li>不要与服务器或数据库密码相同</li><li>在公共设备使用后，及时退出登录</li><li>不要向访客索取密码或验证码</li></ul></aside></div></section></template>
