<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {Upload, X} from 'lucide-vue-next';
import {upload as uploadFile, type UploadProgress as UploadState} from '../api';
import {assetUrl} from '../utils';
import UploadProgress from './UploadProgress.vue';
import VideoPlayer from './VideoPlayer.vue';

defineProps<{modelValue: string}>();
const emit = defineEmits<{(e: 'update:modelValue', value: string): void}>();
const input = ref<HTMLInputElement>();
const busy = ref(false);
const progress = ref<UploadState>({percent: null, phase: 'uploading'});
let controller: AbortController | undefined;
let disposed = false;
onBeforeUnmount(() => {disposed = true; controller?.abort();});
async function upload(event: Event) {
  if (busy.value) return;
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  if (!file) return;
  if (!['video/mp4', 'video/webm'].includes(file.type)) {ElMessage.warning('请选择 MP4 或 WebM 视频'); field.value = ''; return;}
  if (file.size > 25 * 1024 * 1024) {ElMessage.warning('视频大小不能超过 25 MB'); field.value = ''; return;}
  busy.value = true;
  controller = new AbortController();
  progress.value = {percent: null, phase: 'uploading'};
  try {
    const data = new FormData(); data.append('file', file);
    const result = await uploadFile<{url: string; type: string}>('/admin/uploads', data, {signal: controller.signal, onProgress: value => progress.value = value});
    if (disposed) return;
    if (result.type !== 'video') throw new Error('请上传有效的视频文件');
    emit('update:modelValue', result.url);
    ElMessage.success('视频上传成功，发布后前台生效');
  } catch (error) {if (!disposed && (error as Error).name !== 'AbortError') ElMessage.error((error as Error).message);}
  finally {busy.value = false; controller = undefined; field.value = '';}
}
</script>
<template>
  <div class="video-input">
    <div v-if="modelValue" class="video-input-preview"><VideoPlayer class="video-input-player" :src="assetUrl(modelValue)" label="视频预览"/><button type="button" class="icon-btn" aria-label="移除视频" :disabled="busy" @click="emit('update:modelValue', '')"><X :size="16"/></button></div>
    <el-input :model-value="modelValue" :disabled="busy" aria-label="视频 URL" placeholder="视频 URL，或点击上传视频" maxlength="2000" @update:model-value="emit('update:modelValue', $event)"/>
    <div class="image-upload-actions"><el-button :loading="busy" @click="input?.click()"><Upload :size="14"/>上传视频</el-button><span class="field-hint">MP4 / WebM，最大 25 MB；访客点击后播放</span></div>
    <UploadProgress v-if="busy" :progress="progress" @cancel="controller?.abort()"/>
    <input ref="input" type="file" accept="video/mp4,video/webm" aria-label="上传内容视频" hidden @change="upload"/>
  </div>
</template>
