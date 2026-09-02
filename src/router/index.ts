import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "@/views/HomeView.vue";
import GameView from "@/views/GameView.vue";
import HistoryView from "@/views/HistoryView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/game", name: "game", component: GameView },
    { path: "/history", name: "history", component: HistoryView },
  ],
});

export default router;
