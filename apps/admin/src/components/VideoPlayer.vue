<script setup lang="ts">
import {ref, watch} from 'vue';
import {Play} from 'lucide-vue-next';

const props = defineProps<{src: string; label?: string}>();
const emit = defineEmits<{(event: 'loadedmetadata', value: Event): void}>();
const video = ref<HTMLVideoElement>();
const playing = ref(false);
const hasStarted = ref(false);
const playbackError = ref('');

watch(() => props.src, () => {
  playing.value = false;
  hasStarted.value = false;
  playbackError.value = '';
});

async function play() {
  const player = video.value;
  if (!player) return;
  const source = props.src;
  playbackError.value = '';
  try {
    if (player.ended) player.currentTime = 0;
    await player.play();
  } catch {
    if (source === props.src) {
      playing.value = false;
      playbackError.value = '视频暂时无法播放，请重试';
    }
  }
}
</script>

<template>
  <div class="video-player">
    <video ref="video" :src="src" :aria-label="label || '视频'" :controls="hasStarted" playsinline preload="metadata"
      @play="hasStarted = true; playing = true; playbackError = ''" @pause="playing = false" @ended="playing = false"
      @emptied="hasStarted = false; playing = false" @error="playing = false"
      @loadedmetadata="emit('loadedmetadata', $event)"></video>
    <button v-if="!playing" class="video-play-button" type="button" :aria-label="`播放${label || '视频'}`" @click="play">
      <Play :size="27" :stroke-width="1.8" fill="currentColor" aria-hidden="true"/>
    </button>
    <span v-if="playbackError" class="video-play-error" role="status">{{ playbackError }}</span>
  </div>
</template>

<style scoped>
.video-player{position:relative;display:block;max-width:100%;background:#17201a;overflow:hidden;isolation:isolate}
.video-player>video{display:block;width:100%;max-width:100%;height:auto;max-height:var(--video-max-height,none);object-fit:contain}
/* Keep the native seek/volume controls after playback starts, with one central play button. */
.video-player>video::-webkit-media-controls-start-playback-button,.video-player>video::-webkit-media-controls-overlay-play-button{display:none!important;-webkit-appearance:none}
.video-play-button{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1;display:flex;align-items:center;justify-content:center;width:58px;height:58px;padding:0;border:1px solid #ffffffa6;border-radius:50%;background:#14231bc7;color:#fff;cursor:pointer;box-shadow:0 3px 15px #0003;touch-action:manipulation}
.video-play-button:hover{background:#21392deb}
.video-play-button:focus-visible{outline:3px solid #fff;outline-offset:4px}
.video-play-button>svg{margin-left:3px;flex-shrink:0}
.video-play-error{position:absolute;left:8px;right:8px;bottom:40px;text-align:center;font-size:12px;line-height:1.5;color:#fff;background:#14231bde;border-radius:4px;padding:4px;pointer-events:none}
@media(max-width:680px){.video-play-button{width:52px;height:52px}}
</style>
