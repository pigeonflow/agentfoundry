<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Moon, Sun, Cpu } from "lucide-vue-next";
import RunDetails from "./components/RunDetails.vue";
import RunList from "./components/RunList.vue";
import Button from "./components/ui/Button.vue";
import { fetchDashboard } from "./lib/api";
import type { DashboardResponse } from "./types";

// ── theme ────────────────────────────────────────────────────────
const isDark = ref(false);

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("agentfoundry-theme", dark ? "dark" : "light");
}

function toggleTheme(): void {
  isDark.value = !isDark.value;
  applyTheme(isDark.value);
}

// ── data ─────────────────────────────────────────────────────────
const data = ref<DashboardResponse | null>(null);
const selectedRunId = ref<string | undefined>(undefined);
const error = ref<string | null>(null);

async function loadDashboard(): Promise<void> {
  try {
    const payload = await fetchDashboard(selectedRunId.value);
    data.value = payload;
    if (!selectedRunId.value && payload.runCards.length > 0) {
      selectedRunId.value = payload.runCards[0].run.id;
    }
    error.value = null;
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  }
}

function selectRun(runId: string): void {
  selectedRunId.value = runId;
  void loadDashboard();
}

const runCards = computed(() => data.value?.runCards ?? []);
const activeRuns = computed(() => runCards.value.filter((c) => c.run.status === "running"));
const historyRuns = computed(() => runCards.value.filter((c) => c.run.status !== "running"));
const activeRun = computed(() => data.value?.activeRun ?? null);
const activePlan = computed(() => data.value?.activePlan ?? null);
const activeRunCard = computed(() =>
  runCards.value.find((c) => c.run.id === selectedRunId.value) ?? null
);

async function refreshDashboard(): Promise<void> {
  // If selected run was deleted it won't appear in fresh data, auto-deselect
  await loadDashboard();
  if (selectedRunId.value && !data.value?.runCards.some((c) => c.run.id === selectedRunId.value)) {
    selectedRunId.value = undefined;
  }
}

onMounted(() => {
  // Hydrate theme from localStorage
  const stored = localStorage.getItem("agentfoundry-theme");
  const prefersDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  isDark.value = prefersDark;
  applyTheme(prefersDark);

  void loadDashboard();
  setInterval(() => { void loadDashboard(); }, 2000);
});
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Sticky header -->
    <header class="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="flex h-14 max-w-screen-2xl mx-auto items-center gap-3 px-4">
        <Cpu class="h-5 w-5 text-primary" />
        <span class="font-semibold text-sm leading-none">AgentFoundry</span>
        <span class="text-muted-foreground text-xs hidden sm:inline">Command Center</span>

        <div class="ml-auto flex items-center gap-2">
          <span v-if="error" class="text-destructive text-xs truncate max-w-xs">{{ error }}</span>
          <Button variant="ghost" size="icon" @click="toggleTheme" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
            <Sun v-if="isDark" class="h-4 w-4" />
            <Moon v-else class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>

    <!-- Main layout -->
    <div class="flex max-w-screen-2xl mx-auto">
      <!-- Sidebar -->
      <aside class="hidden md:flex md:flex-col md:w-80 md:shrink-0 border-r border-border min-h-[calc(100vh-3.5rem)] sticky top-14">
        <RunList
          :active-runs="activeRuns"
          :history-runs="historyRuns"
          :selected-run-id="selectedRunId"
          @select="selectRun"
          @deselect="selectedRunId = undefined"
          @refresh="refreshDashboard"
        />
      </aside>

      <!-- Mobile sidebar (top) -->
      <div class="md:hidden w-full border-b border-border">
        <RunList
          :active-runs="activeRuns"
          :history-runs="historyRuns"
          :selected-run-id="selectedRunId"
          @select="selectRun"
          @deselect="selectedRunId = undefined"
          @refresh="refreshDashboard"
        />
      </div>

      <!-- Content -->
      <main class="flex-1 min-w-0 p-4">
        <RunDetails :active-run="activeRun" :active-plan="activePlan" :active-run-card="activeRunCard" />
      </main>
    </div>
  </div>
</template>