import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import App from "./App.vue";
import router from "./router";
import "./styles/index.scss";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus);
app.mount("#app");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            window.dispatchEvent(new CustomEvent("holdup-pwa-update"));
          }
        });
      });
    });
  });
}
