<script setup lang="ts">
import {nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {X} from 'lucide-vue-next';
const props=defineProps<{src:string;alt?:string}>();
const emit=defineEmits<{(e:'close'):void}>();
const close=ref<HTMLButtonElement>();
let previous:HTMLElement|null=null;
let overflow='';
function keys(event:KeyboardEvent) {if (event.key==='Escape')emit('close');if(event.key==='Tab'){event.preventDefault();close.value?.focus();}}
function reset(){document.removeEventListener('keydown',keys);document.body.style.overflow=overflow;previous?.focus();}
watch(()=>props.src,async(value,oldValue)=>{
  if(value&&!oldValue){previous=document.activeElement as HTMLElement;overflow=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',keys);await nextTick();close.value?.focus();}
  else if(!value&&oldValue)reset();
});
onBeforeUnmount(()=>{if(props.src)reset();});
</script>
<template><Teleport to="body"><div v-if="src" class="admin-media-preview" role="dialog" aria-modal="true" aria-label="图片大图预览" @click.self="emit('close')"><button ref="close" class="admin-preview-close" aria-label="关闭图片预览" @click="emit('close')"><X :size="26"/></button><img :src="src" :alt="alt || '图片大图'"/><span>点击空白处或按 Esc 关闭</span></div></Teleport></template>
