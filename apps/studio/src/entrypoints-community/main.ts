'use strict';

import * as fs from 'fs';
import path from 'path';
import { app, protocol } from 'electron';
import * as electron from 'electron';
import { ipcMain } from 'electron';
import _ from 'lodash';
import log from '@bksLogger';

// eslint-disable-next-line
require('@electron/remote/main').initialize();
log.info('initializing background (community)');

import MenuHandler from '@/background/NativeMenuBuilder';
import { IGroupedUserSettings, UserSetting } from '@/common/appdb/models/user_setting';
import Connection from '@/common/appdb/Connection';
import Migration from '@/migration/index';
import { buildWindow, getActiveWindows, getCurrentWindow } from '@/background/WindowBuilder';
import platformInfo from '@/common/platform_info';
import bksConfig from '@/common/bksConfig';

import { AppEvent } from '@/common/AppEvent';
import { ProtocolBuilder } from '@/background/lib/electron/ProtocolBuilder';
import { uuidv4 } from '@/lib/uuid';
import installExtension from 'electron-devtools-installer';
import { UtilProcMessage } from '@/types';
import { manageUpdates } from '@/background/update_manager';
import * as sms from 'source-map-support';
import { initializeSecurity } from '@/backend/lib/security';

if (platformInfo.env.development || platformInfo.env.test) {
  sms.install();
}

function initUserDirectory(d: string) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

let utilityProcess: Electron.UtilityProcess;
let newWindows: number[] = [];

async function createUtilityProcess() {
  if (utilityProcess) {
    return;
  }

  const args = {
    bksPlatformInfo: JSON.stringify(platformInfo),
    bksConfigSource: JSON.stringify(bksConfig.source),
  };

  utilityProcess = electron.utilityProcess.fork(path.join(__dirname, 'utility.js'), [], {
    env: { ...process.env, ...args },
    stdio: ['ignore', 'inherit', 'inherit'],
    serviceName: 'SQLMindUtility',
  });

  utilityProcess.on('exit', async (code) => {
    log.log('UTILITY DEAD', code);
    if (code) {
      log.info('Utility process died, restarting');
      utilityProcess = null;
      await createUtilityProcess();
      createAndSendPorts(false, true);
    }
  });

  utilityProcess.on('message', (msg: UtilProcMessage) => {
    if (msg.type === 'openExternal') {
      electron.shell.openExternal(msg.url);
    }
  });

  utilityProcess.postMessage({ type: 'init' });
  return new Promise<void>((resolve) => {
    utilityProcess.on('message', (msg: UtilProcMessage) => {
      if (msg.type === 'ready') {
        resolve();
      }
    });
  });
}

const transports = [log.transports.console, log.transports.file];
if (platformInfo.isDevelopment || platformInfo.debugEnabled) {
  transports.forEach((t) => (t.level = 'silly'));
} else {
  transports.forEach((t) => (t.level = 'warn'));
}

const isDevelopment = platformInfo.isDevelopment;

initUserDirectory(platformInfo.userDirectory);
log.info('initializing user ORM connection!');
const ormConnection = new Connection(platformInfo.appDbPath, false);
log.debug('ELECTRON BOOTING');
log.debug('####################################');

log.debug('Platform Information (Electron)');
log.debug(JSON.stringify(platformInfo, null, 2));

let settings: IGroupedUserSettings;
let menuHandler: any;
log.debug('registering schema');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }]);
protocol.registerSchemesAsPrivileged([{ scheme: 'plugin', privileges: { secure: true, standard: true } }]);
let initialized = false;

async function initBasics() {
  ProtocolBuilder.createAppProtocol();
  ProtocolBuilder.createPluginProtocol();
  if (initialized) return settings;
  initialized = true;
  await ormConnection.connect();
  log.info('running migrations!!');
  const migrator = new Migration(ormConnection, process.env.NODE_ENV);
  await migrator.run();

  log.debug('getting settings');
  settings = await UserSetting.all();

  const defaultChannel = settings.useBeta.defaultValue === 'true' ? 'beta' : 'stable';
  if (platformInfo.parsedAppVersion.channel !== defaultChannel) {
    settings.useBeta.defaultValue = platformInfo.parsedAppVersion.channel === 'beta' ? 'true' : 'false';
    log.debug('Updating the default channel to', platformInfo.parsedAppVersion.channel);
    await settings.useBeta.save();
  }

  log.debug('setting up the menu');
  menuHandler = new MenuHandler(electron, settings, bksConfig);
  menuHandler.initialize();
  manageUpdates(settings.useBeta.valueAsBool);

  ipcMain.on(AppEvent.openExternally, (_e: electron.IpcMainEvent, args: any[]) => {
    const url = args[0];
    if (!url) return;
    electron.shell.openExternal(url);
  });

  return settings;
}

app.on('window-all-closed', () => {
  ipcMain.emit('disable-connection-menu-items');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('platformInfo', () => platformInfo);
ipcMain.handle('bksConfigSource', () => bksConfig.source);

app.on('activate', async (_event, hasVisibleWindows) => {
  if (!hasVisibleWindows) {
    if (!settings) throw 'No settings initialized!';
    await createUtilityProcess();
    buildWindow(settings);
  }
});

app.on('browser-window-created', (_event: electron.Event, window: electron.BrowserWindow) => {
  log.log('window created!!!');
  newWindows.push(window.id);
});

app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    installExtension('iaajmlceplecbljialhhkmedjlpdblhp').catch(() => undefined);
    app.commandLine.appendSwitch('disable-web-security');
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  }

  const options = platformInfo.parsedArgs._.map((url: string) => ({ url }));
  const s = await initBasics();

  if (options.length > 0) {
    await Promise.all(options.map((option) => buildWindow(s, option)));
  } else {
    if (getActiveWindows().length === 0) {
      const s2 = await initBasics();
      initializeSecurity();
      await createUtilityProcess();
      await buildWindow(s2);
    }
  }
});

function createAndSendPorts(filter: boolean, utilDied = false) {
  getActiveWindows().forEach((w) => {
    if (!filter || newWindows.includes(w.winId)) {
      const { port1, port2 } = new electron.MessageChannelMain();
      const sId = uuidv4();
      log.info('SENDING PORT TO RENDERER: ', sId);
      w.sId = sId;
      utilityProcess.postMessage({ type: 'init', sId }, [port1]);
      w.webContents.postMessage('port', { sId, utilDied }, [port2]);
      w.onClose((_event: electron.Event) => {
        utilityProcess.postMessage({ type: 'close', sId });
      });
      if (filter) {
        newWindows = _.without(newWindows, w.winId);
      }
    }
  });
}

ipcMain.handle('requestPorts', async () => {
  log.info('Client requested ports');
  if (!utilityProcess || !utilityProcess.pid) {
    log.info('NO UTIL PROCESS');
    utilityProcess = null;
    await createUtilityProcess();
  }

  if (newWindows.length > 0) {
    createAndSendPorts(true);
  } else {
    createAndSendPorts(false);
  }
});

ipcMain.handle('isMaximized', () => getCurrentWindow().isMaximized());
ipcMain.handle('isFullscreen', () => getCurrentWindow().isFullscreen());
ipcMain.handle('setFullscreen', (_event, value) => getCurrentWindow().setFullscreen(value));
ipcMain.handle('minimizeWindow', () => getCurrentWindow().minimizeWindow());
ipcMain.handle('unmaximizeWindow', () => getCurrentWindow().unmaximizeWindow());
ipcMain.handle('maximizeWindow', () => getCurrentWindow().maximizeWindow());
ipcMain.handle('closeWindow', () => getCurrentWindow().closeWindow());

if (isDevelopment) {
  const rendererTrigger = path.join(process.cwd(), 'tmp/restart-renderer');

  if (fs.existsSync(rendererTrigger)) {
    fs.watchFile(rendererTrigger, (current, previous) => {
      if (current.mtime !== previous.mtime) {
        getActiveWindows().forEach((w) => w.webContents.reload());
      }
    });
  }

  process.on('message', (data) => {
    if (data === 'graceful-exit') {
      app.quit();
    }
  });

  process.on('SIGTERM', () => {
    app.quit();
  });
}
