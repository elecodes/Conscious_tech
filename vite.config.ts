/// <reference types="vitest/config" />
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleAIProxyRequest } from "./src/server/ai-proxy-handler";
import { handleCalendarProxyRequest } from "./src/server/calendar-proxy-handler";

function aiProxyPlugin(): Plugin {
  return {
    name: "ai-proxy-server",
    configureServer(server) {
      server.middlewares.use("/api/ai", (req, res) => {
        handleAIProxyRequest(req, res);
      });
      server.middlewares.use("/api/calendar/fetch-ical", (req, res) => {
        handleCalendarProxyRequest(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/ai", (req, res) => {
        handleAIProxyRequest(req, res);
      });
      server.middlewares.use("/api/calendar/fetch-ical", (req, res) => {
        handleCalendarProxyRequest(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  test: {
    globals: true,
    environment: "node",
  },
});
