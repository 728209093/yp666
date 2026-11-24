<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowRight, Check, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-vue-next';
import type { SliderChallenge, VerificationResponse } from '@yp666/shared';
import { api } from '../api';

const emit = defineEmits<{ verified: [] }>();
const challenge = ref<SliderChallenge | null>(null);
const loading = ref(true);
const submitting = ref(false);
const error = ref('');
const success = ref(false);
const position = ref(0);
const dragging = ref(false);
const track = ref<HTMLElement>();
const trackWidth = ref(320);
const dragStartedAt = ref(0);
let pointerId: number | null = null;
let startClientX = 0;
let startPosition = 0;
let challengeStartedAt = 0;
let observer: ResizeObserver | undefined;
let successTimer: ReturnType<typeof setTimeout> | undefined;

const maxPosition = computed(() => challenge.value ? challenge.value.width - challenge.value.pieceSize : 1);
const ratio = computed(() => position.value / maxPosition.value);
const handleLeft = computed(() => `${ratio.value * Math.max(0, trackWidth.value - 48)}px`);
const fillWidth = computed(() => `${ratio.value * Math.max(0, trackWidth.value - 48) + 48}px`);
const pieceStyle = computed(() => {
  const c = challenge.value;
  if (!c) return {};
  return { left: `${position.value / c.width * 100}%`, top: `${c.pieceY / c.height * 100}%`, width: `${c.pieceSize / c.width * 100}%`, height: `${c.pieceSize / c.height * 100}%` };
});

async function refresh() {
  if (submitting.value) return;
  loading.value = true;
  error.value = '';
  position.value = 0;
  dragStartedAt.value = 0;
  success.value = false;
  try {
    challenge.value = await api<SliderChallenge>('/verification/challenge');
    challengeStartedAt = Date.now();
    await nextTick();
    if (track.value) trackWidth.value = track.value.clientWidth;
  } catch (e) { error.value = e instanceof Error ? e.message : '验证图片加载失败'; }
  finally { loading.value = false; }
}

function begin(event: PointerEvent) {
  if (loading.value || submitting.value || success.value || !challenge.value) return;
  event.preventDefault();
  error.value = '';
  dragging.value = true;
  pointerId = event.pointerId;
  startClientX = event.clientX;
  startPosition = position.value;
  dragStartedAt.value = Date.now();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (!dragging.value || pointerId !== event.pointerId) return;
  const pixels = Math.max(1, trackWidth.value - 48);
  position.value = Math.max(0, Math.min(maxPosition.value, startPosition + (event.clientX - startClientX) / pixels * maxPosition.value));
}

function end(event: PointerEvent) {
  if (!dragging.value || pointerId !== event.pointerId) return;
  dragging.value = false;
  pointerId = null;
  if (position.value > 0) void verify();
}

function cancel() { dragging.value = false; pointerId = null; }

async function verify() {
  if (!challenge.value || submitting.value) return;
  submitting.value = true;
  error.value = '';
  try {
    await api<VerificationResponse>('/verification/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: challenge.value.id, position: Math.round(position.value), elapsedMs: Date.now() - (dragStartedAt.value || challengeStartedAt) }),
    });
    success.value = true;
    successTimer = setTimeout(() => emit('verified'), 550);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '没有对齐，再试一次吧';
    position.value = 0;
    // Challenges are single-use; the user can explicitly refresh without losing the error message.
    try { challenge.value = await api<SliderChallenge>('/verification/challenge'); challengeStartedAt = Date.now(); dragStartedAt.value = 0; }
    catch { /* The visible refresh action remains available. */ }
  } finally { submitting.value = false; }
}

function keyboard(event: KeyboardEvent) {
  if (loading.value || submitting.value || success.value) return;
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
  if (!dragStartedAt.value) dragStartedAt.value = Date.now();
  if (event.key === 'ArrowLeft') position.value = Math.max(0, position.value - (event.shiftKey ? 10 : 2));
  if (event.key === 'ArrowRight') position.value = Math.min(maxPosition.value, position.value + (event.shiftKey ? 10 : 2));
  if (event.key === 'Home') position.value = 0;
  if (event.key === 'End') position.value = maxPosition.value;
  if (event.key === 'Enter' || event.key === ' ') void verify();
}

onMounted(() => {
  if (track.value) {
    trackWidth.value = track.value.clientWidth;
    observer = new ResizeObserver(entries => { trackWidth.value = entries[0]?.contentRect.width || 320; });
    observer.observe(track.value);
  }
  void refresh();
});
onBeforeUnmount(() => { observer?.disconnect(); if (successTimer) clearTimeout(successTimer); });
</script>

<template>
  <div class="slider-verification">
    <div class="puzzle-heading"><span>拼合这一小片风景</span><button class="icon-button" type="button" aria-label="刷新验证图片" :disabled="loading || submitting" @click="refresh"><RefreshCw :size="16" :class="{ spinning: loading }" /></button></div>
    <div class="puzzle-scene" :class="{ 'puzzle-success': success }" :style="{ aspectRatio: challenge ? `${challenge.width}/${challenge.height}` : '320/180' }">
      <template v-if="challenge && !loading">
        <img class="puzzle-background" :src="challenge.background" alt="将拼图片移动到风景图中的缺口处" draggable="false" />
        <img class="puzzle-piece" :src="challenge.piece" :style="pieceStyle" alt="可移动的拼图片" draggable="false" />
      </template>
      <div v-if="loading" class="puzzle-overlay"><LoaderCircle class="spinning" :size="25" /><span>正在准备风景…</span></div>
      <div v-if="success" class="puzzle-overlay puzzle-done"><ShieldCheck :size="34" /><span>验证通过，即将为你开启</span></div>
      <span v-if="!loading && !success" class="puzzle-caption">A LITTLE MOMENT OF CALM</span>
    </div>
    <div ref="track" class="slider-track" :class="{ dragging, success, disabled: loading || submitting }">
      <div class="slider-fill" :style="{ width: fillWidth }"></div>
      <span class="slider-instruction">{{ success ? '验证成功' : submitting ? '正在验证…' : '向右滑动，拼合完整风景' }}</span>
      <button
        class="slider-handle"
        :style="{ left: handleLeft }"
        type="button"
        role="slider"
        aria-label="拖动拼图滑块，方向键可微调，回车提交"
        :aria-valuemin="0"
        :aria-valuemax="maxPosition"
        :aria-valuenow="Math.round(position)"
        :disabled="loading || submitting || success"
        @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="cancel" @keydown="keyboard"
      ><Check v-if="success" :size="20" /><LoaderCircle v-else-if="submitting" class="spinning" :size="20" /><ArrowRight v-else :size="21" /></button>
    </div>
    <p class="verification-feedback" :class="{ error: !!error }" role="status">{{ error || '松开滑块即可验证，键盘用户可用方向键调整后按回车。' }}</p>
  </div>
</template>
