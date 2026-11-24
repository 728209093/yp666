<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { LoaderCircle, RefreshCw } from 'lucide-vue-next';
import { api } from '../api';

type Turnstile = {
  render: (container: HTMLElement, options: {sitekey: string; theme: string; language: string; callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void}) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }
const props = defineProps<{ siteKey: string }>();
const emit = defineEmits<{ verified: [] }>();
const mount = ref<HTMLElement>();
const loading = ref(true);
const error = ref('');
let widget: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;

async function onToken(token: string) {
  loading.value = true;
  try {
    await api('/verification/verify', {method: 'POST', body: JSON.stringify({token})});
    emit('verified');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '验证未完成，请重试';
    reset();
  } finally { loading.value = false; }
}

function render() {
  if (disposed || !window.turnstile || !mount.value || widget) return;
  loading.value = false;
  widget = window.turnstile.render(mount.value, {
    sitekey: props.siteKey, theme: 'light', language: 'zh-cn', callback: token => void onToken(token),
    'error-callback': () => { error.value = '验证服务暂时无法加载，请重试。'; loading.value = false; },
    'expired-callback': () => { error.value = '验证已过期，请重新完成。'; reset(); },
  });
}
function reset() { if (widget) window.turnstile?.reset(widget); }

onMounted(() => {
  if (window.turnstile) { render(); return; }
  if (!document.querySelector('script[data-turnstile]')) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true; script.dataset.turnstile = 'true';
    script.onerror = () => { error.value = '验证服务加载失败，请检查网络后刷新页面。'; loading.value = false; };
    document.head.append(script);
  }
  const started = Date.now();
  timer = setInterval(() => {
    if (window.turnstile) { if (timer) clearInterval(timer); render(); }
    else if (Date.now() - started > 20000) { if (timer) clearInterval(timer); loading.value = false; error.value = '验证服务连接超时，请刷新页面后重试。'; }
  }, 150);
});
onBeforeUnmount(() => { disposed = true; if (timer) clearInterval(timer); if (widget) window.turnstile?.remove(widget); });
</script>

<template>
  <div class="turnstile-verification">
    <div ref="mount"></div>
    <p v-if="loading" class="turnstile-loading"><LoaderCircle class="spinning" :size="18" /> 正在连接安全验证…</p>
    <p v-if="error" class="verification-feedback error" role="alert">{{ error }}</p>
    <button v-if="error && widget" type="button" class="text-button" @click="reset"><RefreshCw :size="15" /> 重新验证</button>
  </div>
</template>
