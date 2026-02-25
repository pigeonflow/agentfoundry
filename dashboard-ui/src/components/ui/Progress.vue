<script setup lang="ts">
import { cn } from "../../lib/utils";
const props = withDefaults(
  defineProps<{ value?: number; max?: number; class?: string }>(),
  { value: 0, max: 100 }
);
const pct = () => Math.min(100, Math.max(0, ((props.value ?? 0) / (props.max || 100)) * 100));
</script>

<template>
  <div
    :class="cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', props.class)"
    role="progressbar"
    :aria-valuenow="props.value"
    :aria-valuemax="props.max"
  >
    <div
      class="h-full w-full flex-1 bg-primary transition-all"
      :style="{ transform: `translateX(-${100 - pct()}%)` }"
    />
  </div>
</template>
