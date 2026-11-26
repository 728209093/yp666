<script setup lang="ts">
import {nextTick, ref, watch} from 'vue';
import {Bold, Italic, Link, RemoveFormatting, Underline} from 'lucide-vue-next';
import {ElMessage} from 'element-plus';
import {safeRichText} from '../richtext';
import {richTextFontFamilies, richTextFontSizes} from '@yp666/shared';

const props = withDefaults(defineProps<{modelValue: string; disabled?: boolean; label?: string; sendOnEnter?: boolean}>(), {label: '回复内容', sendOnEnter: true});
const emit = defineEmits<{(e:'update:modelValue',value:string):void; (e:'send'):void}>();
const editor = ref<HTMLElement>();
const color = ref('#df3434');
const fontSize = ref(16);
const fontFamily = ref('Arial');
let selection: Range | undefined;
function remember() {
  const current = window.getSelection();
  if (current?.rangeCount && editor.value?.contains(current.anchorNode)) selection = current.getRangeAt(0).cloneRange();
}
function restore() {
  editor.value?.focus();
  const current = window.getSelection();
  if (selection && current && editor.value?.contains(selection.commonAncestorContainer)) {current.removeAllRanges(); current.addRange(selection);}
}
function update() {emit('update:modelValue',editor.value?.innerHTML || ''); remember();}
function format(command:string,value?:string) {
  if (props.disabled) return;
  restore();
  document.execCommand('styleWithCSS', false, command === 'foreColor' ? 'true' : 'false');
  document.execCommand(command,false,value);
  document.execCommand('styleWithCSS', false, 'false');
  update();
}
function resizeText() {
  if (props.disabled) return;
  restore();
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand('fontSize', false, '7');
  for (const font of editor.value?.querySelectorAll<HTMLElement>('font[size="7"]') || []) {
    font.style.fontSize = `${fontSize.value}px`;
    font.removeAttribute('size');
  }
  update();
}
function link() {
  remember();
  const url = window.prompt('请输入完整的 HTTPS 链接');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {ElMessage.warning('请输入完整的 http(s) 链接'); return;}
  format('createLink',url);
}
function onPaste(event:ClipboardEvent) {
  event.preventDefault();
  const html = event.clipboardData?.getData('text/html');
  if (html) document.execCommand('insertHTML',false,safeRichText(html));
  else document.execCommand('insertText',false,event.clipboardData?.getData('text/plain') || '');
  update();
}
function onKey(event:KeyboardEvent) {
  if (props.sendOnEnter && event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); emit('send');}
}
watch(()=>props.modelValue,async value=>{
  await nextTick();
  if (editor.value && editor.value.innerHTML !== value && document.activeElement!==editor.value) editor.value.innerHTML=safeRichText(value);
  if (!value && editor.value) {editor.value.innerHTML='';selection=undefined;}
},{immediate:true});
</script>

<template>
  <div class="rich-editor" :class="{disabled}">
    <div class="rich-toolbar" role="toolbar" :aria-label="label === '回复内容' ? '回复格式' : `${label}格式`">
      <select v-model="fontFamily" class="rich-font-family" aria-label="文字字体" :disabled="disabled" @pointerdown="remember" @change="format('fontName', fontFamily)"><option v-for="family in richTextFontFamilies" :key="family" :value="family">{{family === 'Microsoft YaHei' ? '微软雅黑' : family === 'sans-serif' ? '无衬线' : family === 'serif' ? '衬线' : family}}</option></select>
      <select v-model="fontSize" class="rich-font-size" aria-label="文字字号" :disabled="disabled" @pointerdown="remember" @change="resizeText"><option v-for="size in richTextFontSizes" :key="size" :value="size">{{size}}px</option></select>
      <button type="button" title="加粗" aria-label="加粗" :disabled="disabled" @mousedown.prevent="remember" @click="format('bold')"><Bold :size="16"/></button>
      <button type="button" title="斜体" aria-label="斜体" :disabled="disabled" @mousedown.prevent="remember" @click="format('italic')"><Italic :size="16"/></button>
      <button type="button" title="下划线" aria-label="下划线" :disabled="disabled" @mousedown.prevent="remember" @click="format('underline')"><Underline :size="16"/></button>
      <span class="rich-toolbar-divider"></span>
      <label class="rich-color" title="文字颜色"><span :style="{color}">A</span><input v-model="color" type="color" :aria-label="label === '回复内容' ? '回复文字颜色' : `${label}文字颜色`" :disabled="disabled" @pointerdown="remember" @input="format('foreColor',color)"/></label>
      <button type="button" title="插入链接" aria-label="插入链接" :disabled="disabled" @mousedown.prevent="remember" @click="link"><Link :size="16"/></button>
      <button type="button" title="清除格式" aria-label="清除格式" :disabled="disabled" @mousedown.prevent="remember" @click="format('removeFormat')"><RemoveFormatting :size="16"/></button>
      <small>选中文字后设置样式</small>
    </div>
    <div ref="editor" class="rich-input" role="textbox" :aria-label="label" aria-multiline="true" :contenteditable="!disabled" data-placeholder="写下内容，可调整字体、字号、颜色与格式…" @input="update" @keyup="remember" @mouseup="remember" @paste="onPaste" @keydown="onKey"></div>
  </div>
</template>
