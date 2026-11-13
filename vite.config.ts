/// <reference types="vitest/config" />
import { createNotionHandler } from "./src/server/notion-handler";
import { defineConfig, Plugin, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleAIProxyRequest, checkAiProxyTokenWarning } from "./src/server/ai-proxy-handler";
import { handleCalendarProxyRequest } from "./src/server/calendar-proxy-handler";

function aiProxyPlugin(): Plugin {
  const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "NOTION_");
  const notionHandler = createNotionHandler({
    origin: process.env.NOTION_APP_ORIGIN ?? env.NOTION_APP_ORIGIN,
    directory: process.env.NOTION_STORAGE_DIR ?? env.NOTION_STORAGE_DIR,
  });
  return {
    name: "ai-proxy-server",
    configureServer(server) {
      checkAiProxyTokenWarning();
      server.middlewares.use("/api/notion", (req, res) => {
        void notionHandler(req, res);
      });
      server.middlewares.use("/api/ai", (req, res) => {
        handleAIProxyRequest(req, res);
      });
      server.middlewares.use("/api/calendar/fetch-ical", (req, res) => {
        handleCalendarProxyRequest(req, res);
      });
    },
    configurePreviewServer(server) {
      checkAiProxyTokenWarning();
      server.middlewares.use("/api/notion", (req, res) => {
        void notionHandler(req, res);
      });
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/zod")) {
            return "vendor-zod";
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
