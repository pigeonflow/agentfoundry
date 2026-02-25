<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  ListTodo,
  CheckCircle2,
  XCircle,
  Zap,
  ChevronDown,
  ChevronRight,
  FileText,
  Bot,
  Timer,
} from "lucide-vue-next";
import type { DashboardResponse, RunCard } from "../types";
import Card from "./ui/Card.vue";
import CardHeader from "./ui/CardHeader.vue";
import CardTitle from "./ui/CardTitle.vue";
import CardContent from "./ui/CardContent.vue";
import Badge from "./ui/Badge.vue";
import Progress from "./ui/Progress.vue";
import Separator from "./ui/Separator.vue";
import ScrollArea from "./ui/ScrollArea.vue";
import { formatDuration } from "../lib/time";

const props = defineProps<{
  activeRun: DashboardResponse["activeRun"];
  activePlan: DashboardResponse["activePlan"];
  activeRunCard?: RunCard | null;
}>();

const showHistory = ref(false);
const showPrompt = ref(false);

// Live clock for active run duration
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => { clearInterval(timer); });

function isActionable(status: string): boolean {
  return ["pending", "ready", "running", "verifying"].includes(status);
}

const allTasks = computed(() => props.activeRun?.tasks ?? []);
const actionable = computed(() => allTasks.value.filter((t) => isActionable(t.status)));
const history = computed(() => allTasks.value.filter((t) => !isActionable(t.status)));
const total = computed(() => allTasks.value.length);
const completed = computed(() => props.activeRun?.snapshot.completed ?? 0);
const failed = computed(() => props.activeRun?.snapshot.failed ?? 0);
const actionableCount = computed(() =>
  (props.activeRun?.snapshot.pending ?? 0) +
  (props.activeRun?.snapshot.ready ?? 0) +
  (props.activeRun?.snapshot.running ?? 0) +
  (props.activeRun?.snapshot.verifying ?? 0)
);
const estimatedTokens = computed(() => {
  const r = props.activeRun;
  if (!r) return "—";
  const t = r.tokenUsage.estimatedInputTokens + r.tokenUsage.estimatedOutputTokens;
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
});

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" | "running" | "completed" | "failed" | "pending" | "verifying" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "destructive";
    case "running":
      return "running";
    case "verifying":
      return "verifying";
    case "pending":
      return "pending";
    case "ready":
      return "secondary";
    default:
      return "outline";
  }
}

function truncateId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

const spawnedAgents = computed(() => props.activeRunCard?.spawnedAgents ?? 0);
const dispatchers = computed(() => props.activeRunCard?.dispatchers ?? []);
const runStartedAt = computed(() => props.activeRunCard?.run.startedAt ?? "");
const runFinishedAt = computed(() => props.activeRunCard?.run.finishedAt ?? null);
const isRunActive = computed(() => {
  const s = props.activeRunCard?.run.status ?? props.activeRun?.run?.status;
  return s === "running" || s === "pending";
});
</script>

<template>
  <!-- Run selected -->
  <div v-if="activeRun" class="flex flex-col gap-4 p-4">

    <!-- Header -->
    <div class="flex items-start gap-3 flex-wrap">
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <code class="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground truncate max-w-[18ch]">
            {{ truncateId(activeRun.runId) }}
          </code>
          <Badge :variant="statusVariant(activeRun.run?.status ?? 'unknown')">
            {{ activeRun.run?.status ?? "unknown" }}
          </Badge>
        </div>
        <div class="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>{{ total }} tasks</span>
          <span class="flex items-center gap-1">
            <Timer class="h-3 w-3" />
            {{ formatDuration(runStartedAt, isRunActive ? undefined : runFinishedAt, now) }}
            <span v-if="isRunActive" class="text-emerald-500">(live)</span>
          </span>
          <span v-if="spawnedAgents > 0" class="flex items-center gap-1">
            <Bot class="h-3 w-3" />
            {{ spawnedAgents }} spawned
          </span>
        </div>
        <div v-if="dispatchers.length > 0" class="flex items-center gap-1 flex-wrap">
          <span class="text-[10px] text-muted-foreground">via</span>
          <span
            v-for="d in dispatchers"
            :key="d"
            class="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
          >{{ d }}</span>
        </div>
      </div>
    </div>

    <Separator />

    <!-- KPI Grid -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card>
        <CardContent class="pt-4 pb-3 text-center">
          <ListTodo class="mx-auto h-4 w-4 text-muted-foreground mb-1.5" />
          <div class="text-2xl font-bold leading-none">{{ actionableCount }}</div>
          <div class="text-xs text-muted-foreground mt-1">Actionable</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-3 text-center">
          <CheckCircle2 class="mx-auto h-4 w-4 text-emerald-500 mb-1.5" />
          <div class="text-2xl font-bold leading-none text-emerald-600 dark:text-emerald-400">{{ completed }}</div>
          <div class="text-xs text-muted-foreground mt-1">Completed</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-3 text-center">
          <XCircle class="mx-auto h-4 w-4 text-destructive mb-1.5" />
          <div
            class="text-2xl font-bold leading-none"
            :class="failed > 0 ? 'text-destructive' : 'text-foreground'"
          >{{ failed }}</div>
          <div class="text-xs text-muted-foreground mt-1">Failed</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-3 text-center">
          <Zap class="mx-auto h-4 w-4 text-amber-500 mb-1.5" />
          <div class="text-2xl font-bold leading-none text-amber-600 dark:text-amber-400">{{ estimatedTokens }}</div>
          <div class="text-xs text-muted-foreground mt-1">Est. Tokens</div>
        </CardContent>
      </Card>
    </div>

    <!-- Progress bar -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span>Progress</span>
        <span>{{ completed }} / {{ total }}</span>
      </div>
      <Progress :value="completed" :max="total > 0 ? total : 1" />
    </div>

    <!-- Actionable tasks table -->
    <Card>
      <CardHeader class="px-4 pt-4 pb-2">
        <CardTitle class="text-sm">Actionable Tasks</CardTitle>
      </CardHeader>
      <CardContent class="p-0 pb-2">
        <div v-if="actionable.length === 0" class="px-4 pb-3 text-xs text-muted-foreground">
          No actionable tasks.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-card border-b border-border">
              <tr>
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-28">Status</th>
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Title</th>
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-28">Agent</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="task in actionable"
                :key="task.id"
                class="border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors"
              >
                <td class="px-4 py-2.5 text-xs text-muted-foreground">{{ task.sequenceOrder }}</td>
                <td class="px-4 py-2.5">
                  <Badge :variant="statusVariant(task.status)" class="text-xs">{{ task.status }}</Badge>
                </td>
                <td class="px-4 py-2.5 text-xs">{{ task.title }}</td>
                <td class="px-4 py-2.5">
                  <span v-if="task.leaseOwner" class="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate block max-w-[10ch]" :title="task.leaseOwner">{{ task.leaseOwner }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <!-- Collapsible: History -->
    <Card>
      <button
        class="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/30"
        @click="showHistory = !showHistory"
      >
        <CardTitle class="text-sm">Completed / Failed ({{ history.length }})</CardTitle>
        <component :is="showHistory ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
      </button>
      <template v-if="showHistory">
        <Separator />
        <CardContent class="p-0 pb-2">
          <div v-if="history.length === 0" class="px-4 py-3 text-xs text-muted-foreground">No history yet.</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-8">#</th>
                  <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-28">Status</th>
                  <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Title</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="task in history"
                  :key="task.id"
                  class="border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors opacity-75"
                >
                  <td class="px-4 py-2.5 text-xs text-muted-foreground">{{ task.sequenceOrder }}</td>
                  <td class="px-4 py-2.5">
                    <Badge :variant="statusVariant(task.status)" class="text-xs">{{ task.status }}</Badge>
                  </td>
                  <td class="px-4 py-2.5 text-xs">{{ task.title }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </template>
    </Card>

    <!-- Collapsible: Plan Prompt -->
    <Card>
      <button
        class="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/30"
        @click="showPrompt = !showPrompt"
      >
        <div class="flex items-center gap-2">
          <FileText class="h-4 w-4 text-muted-foreground" />
          <CardTitle class="text-sm">Plan Prompt</CardTitle>
        </div>
        <component :is="showPrompt ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
      </button>
      <template v-if="showPrompt">
        <Separator />
        <CardContent class="p-4">
          <ScrollArea class="max-h-48 rounded-md bg-muted/30 p-3">
            <pre class="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{{ activePlan?.inputPrompt || "(no plan prompt)" }}</pre>
          </ScrollArea>
        </CardContent>
      </template>
    </Card>

    <!-- Recent Events timeline -->
    <Card v-if="activeRun.recentEvents?.length">
      <CardHeader class="px-4 pt-4 pb-2">
        <CardTitle class="text-sm">Recent Events</CardTitle>
      </CardHeader>
      <CardContent class="p-4 pt-0">
        <ScrollArea class="max-h-52 rounded-md">
          <div
            v-for="(ev, i) in activeRun.recentEvents"
            :key="i"
            class="flex gap-2 border-b border-border/40 py-1.5 text-xs last:border-0"
          >
            <span class="shrink-0 font-mono text-muted-foreground">{{ String(i + 1).padStart(2, "0") }}.</span>
            <span class="break-all text-foreground/80">{{ JSON.stringify(ev) }}</span>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>

  </div>

  <!-- Empty state -->
  <div v-else class="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
    <ListTodo class="h-10 w-10 text-muted-foreground/25" />
    <p class="text-sm text-muted-foreground">Select a run to view its details</p>
  </div>
</template>
