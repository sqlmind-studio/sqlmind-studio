import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import bks from "@beekeeperstudio/vite-plugin";

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";
  // Keep console logs if KEEP_LOGS env var is set
  const keepLogs = process.env.KEEP_LOGS === '1' || process.env.NODE_ENV === 'development';
  return {
    plugins: [vue(), bks()],
    // Remove console.* and debugger statements from production output.
    // Keeps runtime behavior intact while silencing logs.
    esbuild: {
      drop: (isProd && !keepLogs) ? ["console", "debugger"] : [],
    },
    // Ensure Vue's production build flags are correctly tree-shaken.
    // In Vite, `process.env.NODE_ENV` is not always defined by default.
    define: {
      "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : mode),
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "@sqlmindstudio/plugin": "@beekeeperstudio/plugin",
        "@sqlmindstudio/plugin/dist/eventForwarder": "@beekeeperstudio/plugin/dist/eventForwarder",
        "@sqlmindstudio/vite-plugin": "@beekeeperstudio/vite-plugin"
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
