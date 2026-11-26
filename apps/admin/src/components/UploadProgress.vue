<script setup lang="ts">
import {computed} from 'vue';
import type {UploadProgress} from '../api';

const props = withDefaults(defineProps<{progress: UploadProgress; label?: string; sending?: boolean}>(), {label: '视频上传进度', sending: false});
defineEmits<{(event: 'cancel'): void}>();
const text = computed(() => props.sending ? '正在发送…' : props.progress.phase === 'processing' ? '上传完成，正在处理…' : '正在上传…');
</script>

<template>
  <div class="upload-progress" role="status" aria-live="polite">
    <div class="upload-progress-heading"><span>{{text}}</span><strong v-if="progress.percent !== null">{{progress.percent}}%</strong><button v-if="!sending" type="button" aria-label="取消上传" @click="$emit('cancel')">取消</button></div>
    <progress :aria-label="label" :aria-valuenow="progress.percent ?? undefined" :value="progress.percent ?? undefined" max="100"></progress>
  </div>
</template>

<style scoped>
.upload-progress{width:100%;min-width:0;color:#547861;font-size:12px;display:grid;gap:7px;padding:10px 12px;background:#f3f7ef;border:1px solid #dfe9d7;border-radius:7px;box-sizing:border-box}
.upload-progress-heading{display:flex;align-items:center;gap:8px;min-height:20px;flex-wrap:wrap}.upload-progress-heading>strong{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}.upload-progress-heading>button{border:0;background:transparent;padding:2px 4px;color:#547861;text-decoration:underline;cursor:pointer;font-size:11px}
progress{display:block;width:100%;height:7px;border:0;border-radius:5px;overflow:hidden;accent-color:#547861;background:#dfe9d7}progress::-webkit-progress-bar{background:#dfe9d7;border-radius:5px}progress::-webkit-progress-value{background:#547861;border-radius:5px}progress::-moz-progress-bar{background:#547861;border-radius:5px}progress:indeterminate{background:linear-gradient(90deg,#dfe9d7 0%,#7f9a68 50%,#dfe9d7 100%);background-size:200% 100%;animation:upload-pending 1.2s linear infinite}progress:indeterminate::-webkit-progress-bar{background:transparent}@keyframes upload-pending{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){progress:indeterminate{animation:none}}
</style>
