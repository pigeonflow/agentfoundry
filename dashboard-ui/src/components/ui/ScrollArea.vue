<script setup lang="ts">
import { cn } from "../../lib/utils";
const props = defineProps<{ class?: string }>();
</script>

<template>
  <div :class="cn('relative overflow-hidden', props.class)">
    <div class="h-full w-full overflow-auto rounded-[inherit]">
      <slot />
    </div>
  </div>
</template>
