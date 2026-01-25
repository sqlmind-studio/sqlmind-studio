#!/usr/bin/env node
import esbuild from 'esbuild';
import { spawn, exec, fork } from 'child_process'
import path from 'path';
import _ from 'lodash'
import fs from 'fs'

const isWatching = process.argv[2] === 'watch';

const isCommunityBuild = true;

function getElectronBinary() {
  const winLinux = path.join('../../node_modules/electron/dist/electron')
  const mac = path.join('../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const result = process.platform === 'darwin' ? mac : winLinux
  return path.resolve(result)
}

let electronBin
try {
  electronBin = getElectronBinary()
  console.log("Path to electron: ", electronBin)
} catch (err) {
  console.error(err)
  throw new Error(err)
}

const externals = ['better-sqlite3', 'sqlite3',
        'sequelize', 'reflect-metadata',
        'cassandra-driver', 'mysql2', 'ssh2', 'mysql',
        'oracledb', '@electron/remote', "@google-cloud/bigquery",
        'pg-query-stream', 'electron', '@duckdb/node-api',
        '@mongosh/browser-runtime-electron', '@mongosh/service-provider-node-driver',
        'mongodb-client-encryption', 'sqlanywhere', 'ws'
      ]

let electron = null
/** @type {fs.FSWatcher[]} */
const configWatchers = {}

const restartElectron = _.debounce(() => {
  if (electron) {
    process.kill(electron.pid, 'SIGINT')
  }
  // start electron again
  electron = spawn(electronBin, ['.'], { stdio: 'inherit' })
  electron.on('exit', (code, signal) => {
    console.log('electron exited', code, signal)
    if (!signal) process.exit()
  })
  console.log('spawned electron, pid: ', electron.pid)

}, 500)

function watchConfig(file) {
  if (configWatchers[file]) return
  const watcher = fs.watch(file, () => {
    console.log(`Detected change in ${file}, rebuilding...`);
    restartElectron()
  })
  configWatchers[file] = watcher
}

function getElectronPlugin(name, action = () => restartElectron()) {
  return {
    name: `${name}-plugin`,
    setup(build) {
      if (!isWatching) return
      build.onStart(() => console.log(`ESBUILD: Building ${name}  🏗`))
      build.onEnd(() => {
        console.log(`ESBUILD: Built ${name} ✅`)
        action()
        watchConfig('default.config.ini')
        watchConfig('local.config.ini')
        watchConfig('system.config.ini')
      })
    }
  }
}

function getCommunityImportGuardPlugin() {
  return {
    name: 'community-import-guard',
    setup(build) {
      if (!isCommunityBuild) return

      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path || ''
        if (p.startsWith('@commercial/') || p === '@commercial') {
          return {
            errors: [
              {
                text: `Community build must not import commercial code: '${p}' (imported from '${args.importer || '<entry>'}')`,
              },
            ],
          }
        }

        if (p.includes('src-commercial') || p.includes('src\\commercial') || p.includes('src-commercial')) {
          return {
            errors: [
              {
                text: `Community build must not reference src-commercial: '${p}' (imported from '${args.importer || '<entry>'}')`,
              },
            ],
          }
        }

        return null
      })
    },
  }
}



const env = isWatching ? '"development"' : '"production"';
const commonArgs = {
  platform: 'node',
  publicPath: '.',
  outdir: 'dist',
  bundle: true,
  external: [...externals, '*.woff', '*.woff2', '*.ttf', '*.svg', '*.png'],
  sourcemap: isWatching,
  minify: false,
  // Remove console.* and debugger statements from production output.
  // This keeps dev/watch builds verbose but ships silent production bundles.
  drop: isWatching ? [] : ['console', 'debugger'],
  define: {
    'process.env.NODE_ENV': env
  }
}

  const mainArgs = {
    ...commonArgs,
    entryPoints: ['src/entrypoints-community/main.ts', 'src/entrypoints-community/utility.ts', 'src/entrypoints-community/preload.ts'],
    plugins: [getCommunityImportGuardPlugin(), getElectronPlugin("Main")]
  }

  if(isWatching) {
    const main = await esbuild.context(mainArgs)
    Promise.all([main.watch()])
  } else {
    Promise.all([
      esbuild.build(mainArgs),
    ])
  }
// launch electron
