// vite.config.mjs
import { defineConfig } from "file:///F:/BlogBusiness/sqltools.co/beekeeper-studio-5.4.9/beekeeper-studio-5.4.9/node_modules/vite/dist/node/index.js";
import vue from "file:///F:/BlogBusiness/sqltools.co/beekeeper-studio-5.4.9/beekeeper-studio-5.4.9/node_modules/@vitejs/plugin-vue2/dist/index.mjs";
import path from "path";
import commonjs from "file:///F:/BlogBusiness/sqltools.co/beekeeper-studio-5.4.9/beekeeper-studio-5.4.9/node_modules/vite-plugin-commonjs/dist/index.mjs";
var __vite_injected_original_dirname = "F:\\BlogBusiness\\sqltools.co\\beekeeper-studio-5.4.9\\beekeeper-studio-5.4.9\\apps\\studio";
var vite_config_default = defineConfig({
  plugins: [vue(), commonjs()],
  base: "/",
  // Set the base URL for the app
  optimizeDeps: {
    exclude: [
      // Exclude native modules from optimization
      // Without this, the build fails :(
      "cpu-features",
      "ssh2",
      "kerberos",
      "better-sqlite3",
      "oracledb"
    ]
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src"),
      "@commercial": path.resolve(__vite_injected_original_dirname, "./src-commercial"),
      "@shared": path.resolve(__vite_injected_original_dirname, "./src/shared"),
      "assets": path.resolve(__vite_injected_original_dirname, "./src/assets"),
      "@bksLogger": path.resolve(__vite_injected_original_dirname, "./src/lib/log/rendererLogger")
    }
  },
  build: {
    outDir: "dist/renderer",
    // Output directory for the renderer process
    emptyOutDir: true,
    // Clears the directory before building
    rollupOptions: {
      external: [],
      input: "./index.html",
      // Entry point for the renderer process
      output: {
        format: "cjs"
      }
    }
  },
  server: {
    port: 3003
    // Development server port
    // open: './src/index.html'
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcubWpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRjpcXFxcQmxvZ0J1c2luZXNzXFxcXHNxbHRvb2xzLmNvXFxcXGJlZWtlZXBlci1zdHVkaW8tNS40LjlcXFxcYmVla2VlcGVyLXN0dWRpby01LjQuOVxcXFxhcHBzXFxcXHN0dWRpb1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRjpcXFxcQmxvZ0J1c2luZXNzXFxcXHNxbHRvb2xzLmNvXFxcXGJlZWtlZXBlci1zdHVkaW8tNS40LjlcXFxcYmVla2VlcGVyLXN0dWRpby01LjQuOVxcXFxhcHBzXFxcXHN0dWRpb1xcXFx2aXRlLmNvbmZpZy5tanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Y6L0Jsb2dCdXNpbmVzcy9zcWx0b29scy5jby9iZWVrZWVwZXItc3R1ZGlvLTUuNC45L2JlZWtlZXBlci1zdHVkaW8tNS40LjkvYXBwcy9zdHVkaW8vdml0ZS5jb25maWcubWpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgdnVlIGZyb20gJ0B2aXRlanMvcGx1Z2luLXZ1ZTInO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCdcbmltcG9ydCBjb21tb25qcyBmcm9tICd2aXRlLXBsdWdpbi1jb21tb25qcydcblxuLy8gVG8gbW92ZSB0byBFbGVjdHJvbiAxOSsgd2UgbmVlZCB0byBzdG9wIHVzaW5nIG5vZGUgbGlicmFyaWVzXG4vLyBpbiB0aGUgcmVuZGVyZXIuXG4vLyBUaGlzIGluY2x1ZGVzOiBub2RlIHNpZGUgbGlicywgYW5kIHN0dWZmIHdlJ3ZlIGltcG9ydGVkIG91cnNlbHZlc1xuXG5cbi8vIEltcG9ydGVkIGxpYnMgdG8gc3RvcCB1c2luZ1xuLy8gVGhlcmUgYXJlIG1vdGUgdG9vIChlZyBwZyksIHRoZXNlIGFyZSBqdXN0IHRoZSBuYXRpdmUgb25lc1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3Z1ZSgpLCBjb21tb25qcygpXSxcbiAgYmFzZTogJy8nLCAvLyBTZXQgdGhlIGJhc2UgVVJMIGZvciB0aGUgYXBwXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFtcbiAgICAgIC8vIEV4Y2x1ZGUgbmF0aXZlIG1vZHVsZXMgZnJvbSBvcHRpbWl6YXRpb25cbiAgICAgIC8vIFdpdGhvdXQgdGhpcywgdGhlIGJ1aWxkIGZhaWxzIDooXG4gICAgICAnY3B1LWZlYXR1cmVzJyxcbiAgICAgICdzc2gyJyxcbiAgICAgICdrZXJiZXJvcycsXG4gICAgICAnYmV0dGVyLXNxbGl0ZTMnLFxuICAgICAgJ29yYWNsZWRiJ1xuICAgIF1cbn0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICBcIkBjb21tZXJjaWFsXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMtY29tbWVyY2lhbFwiKSxcbiAgICAgIFwiQHNoYXJlZFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL3NoYXJlZFwiKSxcbiAgICAgIFwiYXNzZXRzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYy9hc3NldHMnKSxcbiAgICAgIFwiQGJrc0xvZ2dlclwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMvbGliL2xvZy9yZW5kZXJlckxvZ2dlcicpXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0L3JlbmRlcmVyJywgLy8gT3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIHJlbmRlcmVyIHByb2Nlc3NcbiAgICBlbXB0eU91dERpcjogdHJ1ZSwgLy8gQ2xlYXJzIHRoZSBkaXJlY3RvcnkgYmVmb3JlIGJ1aWxkaW5nXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgZXh0ZXJuYWw6IFtdLFxuICAgICAgaW5wdXQ6ICcuL2luZGV4Lmh0bWwnLCAvLyBFbnRyeSBwb2ludCBmb3IgdGhlIHJlbmRlcmVyIHByb2Nlc3NcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBmb3JtYXQ6ICdjanMnXG4gICAgICB9LFxuICAgIH1cbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogMzAwMywgLy8gRGV2ZWxvcG1lbnQgc2VydmVyIHBvcnRcbiAgICAvLyBvcGVuOiAnLi9zcmMvaW5kZXguaHRtbCdcbiAgfVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWljLFNBQVMsb0JBQW9CO0FBQzlkLE9BQU8sU0FBUztBQUNoQixPQUFPLFVBQVU7QUFDakIsT0FBTyxjQUFjO0FBSHJCLElBQU0sbUNBQW1DO0FBY3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxJQUFJLEdBQUcsU0FBUyxDQUFDO0FBQUEsRUFDM0IsTUFBTTtBQUFBO0FBQUEsRUFDTixjQUFjO0FBQUEsSUFDWixTQUFTO0FBQUE7QUFBQTtBQUFBLE1BR1A7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0o7QUFBQSxFQUNFLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxNQUNwQyxlQUFlLEtBQUssUUFBUSxrQ0FBVyxrQkFBa0I7QUFBQSxNQUN6RCxXQUFXLEtBQUssUUFBUSxrQ0FBVyxjQUFjO0FBQUEsTUFDakQsVUFBVSxLQUFLLFFBQVEsa0NBQVcsY0FBYztBQUFBLE1BQ2hELGNBQWMsS0FBSyxRQUFRLGtDQUFXLDhCQUE4QjtBQUFBLElBQ3RFO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBO0FBQUEsSUFDUixhQUFhO0FBQUE7QUFBQSxJQUNiLGVBQWU7QUFBQSxNQUNiLFVBQVUsQ0FBQztBQUFBLE1BQ1gsT0FBTztBQUFBO0FBQUEsTUFDUCxRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQTtBQUFBLEVBRVI7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
