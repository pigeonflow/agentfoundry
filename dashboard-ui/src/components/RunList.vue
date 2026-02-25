<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Activity, Clock, History, Zap, Square, Trash2 } from "lucide-vue-next";
import Badge from "./ui/Badge.vue";
import Progress from "./ui/Progress.vue";
import ScrollArea from "./ui/ScrollArea.vue";
import Separator from "./ui/Separator.vue";
import type { RunCard } from "../types";
import { stopRun, deleteRun } from "../lib/api";
import { formatDuration } from "../lib/time";


// Live clock — ticks every second for active run durations
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => { clearInterval(timer); });

const props = defineProps<{
  activeRuns: RunCard[];
  historyRuns: RunCard[];
  selectedRunId?: string;
}>();

const emit = defineEmits<{
  select: [runId: string];
  deselect: [];
  refresh: [];
}>();

// Client-side cleared history IDs — persisted to localStorage
const STORAGE_KEY = "agentfoundry:clearedRunIds";
function loadClearedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveClearedIds(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}
const clearedIds = ref<Set<string>>(loadClearedIds());

const visibleHistory = computed(() =>
  props.historyRuns.filter((c) => !clearedIds.value.has(c.run.id))
);

function clearHistory(): void {
  for (const card of props.historyRuns) {
    clearedIds.value.add(card.run.id);
  }
  saveClearedIds(clearedIds.value);
  if (props.selectedRunId && clearedIds.value.has(props.selectedRunId)) {
    emit("deselect");
  }
}

function totalTasks(card: RunCard): number {
  const s = card.snapshot;
  return s.pending + s.ready + s.running + s.verifying + s.completed + s.failed + s.blocked;
}

function shortId(id: string): string {
  return id.slice(-12);
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function statusVariant(status: string): "completed" | "failed" | "pending" | "running" | "verifying" | "default" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "verifying") return "verifying";
  return "pending";
}

async function handleStop(runId: string): Promise<void> {
  try {
    await stopRun(runId);
    emit("refresh");
  } catch {
    // silently ignore — dashboard will self-correct on next poll
  }
}

async function handleDelete(runId: string): Promise<void> {
  try {
    await deleteRun(runId);
    clearedIds.value.add(runId); // remove immediately from view
    saveClearedIds(clearedIds.value);
    if (runId === props.selectedRunId) emit("deselect");
    emit("refresh");
  } catch {
    // silently ignore
  }
}
</script>

<template>
  <ScrollArea class="h-full">
    <div class="p-3 space-y-4">

      <!-- ── Active Runs ─────────────────────────────────────────── -->
      <section>
        <div class="flex items-center gap-1.5 px-1 mb-2">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active</h2>
          <span class="ml-auto text-xs text-muted-foreground">{{ activeRuns.length }}</span>
        </div>

        <div v-if="activeRuns.length === 0" class="flex flex-col items-center gap-2 py-6 text-muted-foreground">
          <Activity class="h-8 w-8 opacity-30" />
          <p class="text-xs">No active runs</p>
        </div>

        <div
          v-for="card in activeRuns"
          :key="card.run.id"
          class="mb-2 rounded-lg border-l-4 border-l-emerald-500 border-t border-r border-b border-border bg-card p-3 cursor-pointer hover:bg-accent/40 transition-colors"
          :class="{ 'ring-2 ring-primary ring-offset-1 ring-offset-background': selectedRunId === card.run.id }"
          @click="emit('select', card.run.id)"
        >
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="font-mono text-xs font-medium truncate">{{ shortId(card.run.id) }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <span class="text-[10px] text-muted-foreground">{{ formatDuration(card.run.startedAt, undefined, now) }}</span>
              <Badge variant="running">live</Badge>
              <button
                class="h-5 w-5 inline-flex items-center justify-center rounded text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors"
                title="Stop"
                @click.stop="handleStop(card.run.id)"
              ><Square class="h-3 w-3" /></button>
              <button
                class="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete"
                @click.stop="handleDelete(card.run.id)"
              ><Trash2 class="h-3 w-3" /></button>
            </div>
          </div>

          <Progress
            :value="card.snapshot.completed"
            :max="totalTasks(card) || 1"
            class="mb-2 h-1.5"
          />

          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ card.snapshot.completed }}/{{ totalTasks(card) }} tasks</span>
            <span class="flex items-center gap-1">
              <Zap class="h-3 w-3" />
              {{ formatTokens(card.tokenUsage.estimatedInputTokens + card.tokenUsage.estimatedOutputTokens) }}
            </span>
          </div>
        </div>
      </section>

      <Separator />

      <!-- ── History ─────────────────────────────────────────────── -->
      <section>
        <div class="flex items-center gap-1.5 px-1 mb-2">
          <History class="h-3.5 w-3.5 text-muted-foreground" />
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</h2>
          <span class="text-xs text-muted-foreground">{{ visibleHistory.length }}</span>
          <Button
            v-if="visibleHistory.length > 0"
            variant="ghost"
            size="sm"
            class="ml-auto h-5 px-1.5 text-[10px] text-muted-foreground"
            @click="clearHistory"
          >
            Clear
          </Button>
        </div>

        <div v-if="visibleHistory.length === 0" class="flex flex-col items-center gap-2 py-6 text-muted-foreground">
          <Clock class="h-8 w-8 opacity-30" />
          <p class="text-xs">No historical runs yet</p>
        </div>

        <div
          v-for="card in visibleHistory"
          :key="card.run.id"
          class="mb-1.5 rounded-lg border border-border bg-card/50 p-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
          :class="{ 'ring-2 ring-primary ring-offset-1 ring-offset-background': selectedRunId === card.run.id }"
          @click="emit('select', card.run.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-muted-foreground truncate">{{ shortId(card.run.id) }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <Badge :variant="statusVariant(card.run.status)" class="text-[10px]">
                {{ card.run.status }}
              </Badge>
              <button
                class="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete"
                @click.stop="handleDelete(card.run.id)"
              ><Trash2 class="h-3 w-3" /></button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5">
            <span>{{ card.snapshot.completed }} done · {{ card.snapshot.failed }} failed</span>
            <span class="flex items-center gap-1">
              <Clock class="h-2.5 w-2.5" />
              {{ formatDuration(card.run.startedAt, card.run.finishedAt, now) }}
            </span>
          </div>
        </div>
      </section>

    </div>
  </ScrollArea>
</template>
