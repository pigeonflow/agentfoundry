<script setup lang="ts">
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        running: "border-transparent bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
        completed: "border-transparent bg-green-500/20 text-green-700 dark:text-green-400",
        failed: "border-transparent bg-red-500/20 text-red-600 dark:text-red-400",
        pending: "border-transparent bg-slate-400/20 text-slate-600 dark:text-slate-400",
        verifying: "border-transparent bg-amber-500/20 text-amber-600 dark:text-amber-400",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

type BadgeVariants = VariantProps<typeof badgeVariants>;

const props = withDefaults(
  defineProps<{ variant?: BadgeVariants["variant"]; class?: string }>(),
  { variant: "default" }
);
</script>

<template>
  <div :class="cn(badgeVariants({ variant: props.variant }), props.class)">
    <slot />
  </div>
</template>
