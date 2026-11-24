<script setup lang="ts">
defineProps<{ small?: boolean }>();
</script>

<template>
  <span class="brand-mark" :class="{ small }" aria-hidden="true">
    <svg viewBox="0 0 40 40" fill="none">
      <path d="M10 28C12.8 19.6 18.5 13.7 30 10C30.3 21.5 24.6 29.8 14.5 28.6" fill="currentColor" opacity=".9" />
      <path d="M10 31C13.2 24.8 18.3 20.2 25.3 16" stroke="var(--mark-stroke, #fff)" stroke-width="1.8" stroke-linecap="round" />
      <path d="M9 22C7.6 17.5 8.6 12.5 12.8 8C17.7 12.8 19.1 16.6 17.9 20.7" fill="currentColor" opacity=".58" />
    </svg>
  </span>
</template>
