<script setup lang="ts">
import {ref} from 'vue';
import {ElMessage} from 'element-plus';
import {Upload, X} from 'lucide-vue-next';
import {api} from '../api';
import {assetUrl} from '../utils';

defineProps<{modelValue: string}>();
const emit = defineEmits<{(e: 'update:modelValue', value: string): void}>();
const input = ref<HTMLInputElement>();
const busy = ref(false);
async function upload(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  if (!file) return;
  if (!['video/mp4', 'video/webm'].includes(file.type)) {ElMessage.warning('请选择 MP4 或 WebM 视频'); field.value = ''; return;}
  if (file.size > 25 * 1024 * 1024) {ElMessage.warning('视频大小不能超过 25 MB'); field.value = ''; return;}
  busy.value = true;
  try {
    const data = new FormData(); data.append('file', file);
    const result = await api<{url: string; type: string}>('/admin/uploads', {method: 'POST', body: data});
    if (result.type !== 'video') throw new Error('请上传有效的视频文件');
    emit('update:modelValue', result.url);
    ElMessage.success('视频上传成功，发布后前台生效');
  } catch (error) {ElMessage.error((error as Error).message);}
  finally {busy.value = false; field.value = '';}
}
</script>
<template>
  <div class="video-input">
    <div v-if="modelValue" class="video-input-preview"><video :src="assetUrl(modelValue)" controls playsinline preload="metadata" aria-label="视频预览"></video><button type="button" class="icon-btn" aria-label="移除视频" @click="emit('update:modelValue', '')"><X :size="16"/></button></div>
    <el-input :model-value="modelValue" aria-label="视频 URL" placeholder="视频 URL，或点击上传视频" maxlength="2000" @update:model-value="emit('update:modelValue', $event)"/>
    <div class="image-upload-actions"><el-button :loading="busy" @click="input?.click()"><Upload :size="14"/>上传视频</el-button><span class="field-hint">MP4 / WebM，最大 25 MB；访客点击后播放</span></div>
    <input ref="input" type="file" accept="video/mp4,video/webm" aria-label="上传内容视频" hidden @change="upload"/>
  </div>
</template>
