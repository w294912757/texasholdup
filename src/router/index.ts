import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "@/views/HomeView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    {
      path: "/game",
      name: "game",
      component: () => import("@/views/GameView.vue"),
    },
    {
      path: "/history",
      name: "history",
      component: () => import("@/views/HistoryView.vue"),
    },
    {
      path: "/training",
      name: "training",
      component: () => import("@/views/TrainingView.vue"),
    },
    {
      path: "/statistics",
      name: "statistics",
      component: () => import("@/views/StatisticsView.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
    },
    {
      path: "/storage",
      name: "storage",
      component: () => import("@/views/StorageView.vue"),
    },
    {
      path: "/rules",
      name: "rules",
      component: () => import("@/views/RulesView.vue"),
    },
    {
      path: "/diagnostics",
      name: "diagnostics",
      component: () => import("@/views/DiagnosticsView.vue"),
    },
  ],
});

export default router;
