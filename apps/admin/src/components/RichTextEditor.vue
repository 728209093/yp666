<script setup lang="ts">
import {nextTick, ref, watch} from 'vue';
import {Bold, Italic, Link, RemoveFormatting, Underline} from 'lucide-vue-next';
import {ElMessage} from 'element-plus';
import {safeRichText} from '../richtext';

const props = defineProps<{modelValue: string; disabled?: boolean}>();
const emit = defineEmits<{(e:'update:modelValue',value:string):void; (e:'send'):void}>();
const editor = ref<HTMLElement>();
const color = ref('#df3434');
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
function link() {
  remember();
  const url = window.prompt('请输入完整的 HTTPS 链接');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {ElMessage.warning('请输入完整的 http(s) 链接'); return;}
  format('createLink',url);
}
function onPaste(event:ClipboardEvent) {
  event.preventDefault();
  document.execCommand('insertText',false,event.clipboardData?.getData('text/plain') || '');
  update();
}
function onKey(event:KeyboardEvent) {
  if (event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); emit('send');}
}
watch(()=>props.modelValue,async value=>{
  await nextTick();
  if (editor.value && editor.value.innerHTML !== value && document.activeElement!==editor.value) editor.value.innerHTML=safeRichText(value);
  if (!value && editor.value) {editor.value.innerHTML='';selection=undefined;}
},{immediate:true});
</script>

<template>
  <div class="rich-editor" :class="{disabled}">
    <div class="rich-toolbar" role="toolbar" aria-label="回复格式">
      <button type="button" title="加粗" aria-label="加粗" :disabled="disabled" @mousedown.prevent="remember" @click="format('bold')"><Bold :size="16"/></button>
      <button type="button" title="斜体" aria-label="斜体" :disabled="disabled" @mousedown.prevent="remember" @click="format('italic')"><Italic :size="16"/></button>
      <button type="button" title="下划线" aria-label="下划线" :disabled="disabled" @mousedown.prevent="remember" @click="format('underline')"><Underline :size="16"/></button>
      <span class="rich-toolbar-divider"></span>
      <label class="rich-color" title="文字颜色"><span :style="{color}">A</span><input v-model="color" type="color" aria-label="回复文字颜色" :disabled="disabled" @pointerdown="remember" @input="format('foreColor',color)"/></label>
      <button type="button" title="插入链接" aria-label="插入链接" :disabled="disabled" @mousedown.prevent="remember" @click="link"><Link :size="16"/></button>
      <button type="button" title="清除格式" aria-label="清除格式" :disabled="disabled" @mousedown.prevent="remember" @click="format('removeFormat')"><RemoveFormatting :size="16"/></button>
      <small>选中文字后设置样式</small>
    </div>
    <div ref="editor" class="rich-input" role="textbox" aria-label="回复内容" aria-multiline="true" :contenteditable="!disabled" data-placeholder="写下你的回复，可设置文字颜色与格式…" @input="update" @keyup="remember" @mouseup="remember" @paste="onPaste" @keydown="onKey"></div>
  </div>
</template>
