<script setup lang="ts">
import {computed, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {ImagePlus, Upload, X} from 'lucide-vue-next';
import {api} from '../api';
import {assetUrl} from '../utils';
const props = withDefaults(defineProps<{modelValue: string; label?: string; round?: boolean}>(), {label: '图片链接'});
const emit = defineEmits<{(e: 'update:modelValue', value: string): void}>();
const input = ref<HTMLInputElement>();
const busy = ref(false);
const preview = computed(() => assetUrl(props.modelValue));
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {ElMessage.warning('图片大小不能超过 5 MB'); return;}
  busy.value = true;
  try {const data = new FormData(); data.append('file', file); const result = await api<{url: string}>('/admin/uploads', {method: 'POST', body: data}); emit('update:modelValue', result.url); ElMessage.success('图片上传成功，保存草稿后生效');}
  catch (error) {ElMessage.error((error as Error).message);} finally {busy.value = false; if (input.value) input.value.value = '';}
}
</script>
<template><div class="image-input"><div v-if="modelValue" class="image-preview" :class="{round}"><img :src="preview" :alt="label"/><button type="button" class="image-remove" aria-label="移除图片" @click="emit('update:modelValue', '')"><X :size="13"/></button></div><div class="image-input-fields"><el-input :model-value="modelValue" :placeholder="label" maxlength="2000" @update:model-value="emit('update:modelValue', $event)"/><div class="image-upload-actions"><el-button :loading="busy" @click="input?.click()"><Upload :size="14"/>上传图片</el-button><span class="field-hint">JPG / PNG / WebP，最大 5 MB</span></div></div><input ref="input" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="upload"/></div></template>
