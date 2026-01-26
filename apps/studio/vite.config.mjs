import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue2';
import path from 'path'
import commonjs from 'vite-plugin-commonjs'

// To move to Electron 19+ we need to stop using node libraries
// in the renderer.
// This includes: node side libs, and stuff we've imported ourselves


// Imported libs to stop using
// There are mote too (eg pg), these are just the native ones

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isCommunityBuild = true;

  const communityImportGuard = () => ({
    name: 'community-import-guard',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!isCommunityBuild) return null

      if (source === '@commercial' || source.startsWith('@commercial/')) {
        throw new Error(
          `Community build must not import commercial code: '${source}' (imported from '${importer || '<entry>'}')`
        )
      }

      if (source.includes('src-commercial') || source.includes('src\\commercial')) {
        throw new Error(
          `Community build must not reference src-commercial: '${source}' (imported from '${importer || '<entry>'}')`
        )
      }

      return null
    },
  })

  const rendererEntrypointRewriter = () => ({
    name: 'renderer-entrypoint-rewriter',
    enforce: 'pre',
    transformIndexHtml(html, ctx) {
      const communityEntry = '/src/entrypoints-community/renderer.ts'
      const desired = communityEntry

      // In production builds, Vite will inject the bundled asset. We must ensure we don't
      // also ship a lingering /src/... entrypoint reference (which will 404 in packaged builds).
      if (ctx?.bundle) {
        return html
          .replace(
            new RegExp(`<script\\s+[^>]*type=\"module\"[^>]*src=\"${communityEntry.replace(/\//g, '\\/')}\"[^>]*>\\s*<\\/script>\\s*`, 'g'),
            ''
          )
      }

      return html
    },
  })

  return {
    plugins: [communityImportGuard(), rendererEntrypointRewriter(), vue(), commonjs()],
    base: '/', // Set the base URL for the app
    // Remove console.* and debugger statements from production output.
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      ...(isCommunityBuild ? { COMMUNITY_BUILD: true } : { COMMUNITY_BUILD: false }),
    },
    optimizeDeps: {
      exclude: [
        // Exclude native modules from optimization
        // Without this, the build fails :(
        'cpu-features',
        'ssh2',
        'kerberos',
        'better-sqlite3',
        'oracledb'
      ]
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared": path.resolve(__dirname, "./src/shared"),
        "assets": path.resolve(__dirname, './src/assets'),
        "@bksLogger": path.resolve(__dirname, './src/lib/log/rendererLogger'),
        "@sqlmindstudio/ui-kit": path.resolve(__dirname, '../ui-kit/dist')
      },
    },
    build: {
      outDir: 'dist/renderer', // Output directory for the renderer process
      emptyOutDir: true, // Clears the directory before building
      rollupOptions: {
        external: [],
        input: './index.html', // Entry point for the renderer process
        output: {
          format: 'cjs'
        },
      }
    },
    server: {
      port: 3003, // Development server port
      // open: './src/index.html'
    }
    // open: './src/index.html'
  }
});
