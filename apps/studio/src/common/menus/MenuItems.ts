import { IMenuActionHandler } from '@/common/interfaces/IMenuActionHandler';
import { DevLicenseState } from '@/lib/license';
import { IPlatformInfo } from '../IPlatformInfo';
import { IGroupedUserSettings } from '../transport/TransportUserSetting';


export function menuItems(actionHandler: IMenuActionHandler, settings: IGroupedUserSettings, platformInfo: IPlatformInfo) {
  return {
    upgradeModal: (label: string) => {
      return {
        id: `upgrade-${label}`,
        label: label,
        click: actionHandler.upgradeModal
      }
    },
    quit: {
      id: 'quit',
      label: platformInfo.isMac ? 'Quit' : 'Exit',
      icon: 'exit_to_app',
      accelerator: platformInfo.isMac ? 'CommandOrControl+Q' : undefined,
      click: actionHandler.quit
    },
    undo: {
      id: 'undo',
      label: "Undo",
      icon: 'undo',
      accelerator: "CommandOrControl+Z",
      click: actionHandler.undo
    },
    redo: {
      id: "redo",
      label: "Redo",
      icon: 'redo',
      accelerator: platformInfo.isWindows ? 'Ctrl+Y' : 'Shift+CommandOrControl+Z',
      click: actionHandler.redo
    },
    cut: {
      id: 'cut',
      label: 'Cut',
      icon: 'content_cut',
      accelerator: 'CommandOrControl+X',
      click: actionHandler.cut,
      registerAccelerator: false

    },
    copy: {
      id: 'copy',
      label: 'Copy',
      icon: 'content_copy',
      accelerator: 'CommandOrControl+C',
      click: actionHandler.copy,
      registerAccelerator: false
    },
    paste: {
      id: 'paste',
      label: 'Paste',
      icon: 'content_paste',
      accelerator: 'CommandOrControl+V',
      click: actionHandler.paste,
      registerAccelerator: false
    },

    selectAll: {
      id: 'select-all',
      label: 'Select All',
      icon: 'select_all',
      accelerator: 'CommandOrControl+A',
      click: actionHandler.selectAll
    },
    // view
    zoomreset: {
      id: 'zoom-reset',
      label: "Reset Zoom",
      icon: 'zoom_out_map',
      accelerator: "CommandOrControl+0",
      click: actionHandler.zoomreset
    },
    zoomin: {
      id: 'zoom-in',
      label: "Zoom In",
      icon: 'zoom_in',
      accelerator: 'CommandOrControl+=',
      click: actionHandler.zoomin
    },
    zoomout: {
      id: 'zoom-out',
      label: "Zoom Out",
      icon: 'zoom_out',
      accelerator: "CommandOrControl+-",
      click: actionHandler.zoomout
    },
    fullscreen: {
      id: 'fullscreen',
      label: "Toggle Full Screen",
      icon: 'fullscreen',
      accelerator: platformInfo.isMac ? 'Command+Control+F' : 'F11',
      click: actionHandler.fullscreen
    },
    // help
    about: {
      id: 'about',
      label: 'About SQLMind Studio',
      icon: 'info',
      click: actionHandler.about
    },
    devtools: {
      id: 'dev-tools',
      label: "Show Developer Tools",
      icon: 'code',
      nonNativeMacOSRole: true,
      click: actionHandler.devtools
    },
    restart: {
      id: 'restart',
      label: "Restart SQLMind",
      icon: 'refresh',
      click: actionHandler.restart
    },
    checkForUpdate: {
      id: 'updatecheck',
      label: 'Check for Software Updates',
      icon: 'system_update',
      click: actionHandler.checkForUpdates
    },
    opendocs : {
      id: 'opendocs',
      label: 'Documentation',
      icon: 'menu_book',
      click: actionHandler.opendocs
    },
    support: {
      id: 'contactSupport',
      label: 'Contact Support',
      icon: 'support_agent',
      click: actionHandler.contactSupport
    },
    reload: {
      id: 'reload-window',
      label: "Reload Window",
      icon: 'replay',
      accelerator: "CommandOrControl+Shift+R",
      click: actionHandler.reload
    },
    newWindow: {
      id: 'new-window',
      label: "New Window",
      icon: 'open_in_new',
      accelerator: "CommandOrControl+Shift+N",
      click: actionHandler.newWindow
    },
    addSQLMind: {
      id: 'add-sqlmind',
      label: "Add Demo Database",
      icon: 'add_circle',
      click: actionHandler.addSQLMind
    },
    newTab: {
      id: "new-query-menu",
      label: "New Tab",
      icon: 'add',
      accelerator: "CommandOrControl+T",
      click: actionHandler.newQuery,
      enabled: false,
    },
    closeTab: {
      id: 'close-tab',
      label: "Close Tab",
      icon: 'close',
      accelerator: "CommandOrControl+W",
      click: actionHandler.closeTab,
      registerAccelerator: false,
      enabled: false,
    },
    importSqlFiles: {
      id: 'import-sql-files',
      label: "Import SQL Files",
      icon: 'upload_file',
      accelerator: "CommandOrControl+I",
      click: actionHandler.importSqlFiles,
      showWhenConnected: true,
      enabled: false,
    },
    quickSearch: {
      id: 'go-to',
      label: "Quick Search",
      icon: 'search',
      accelerator: "CommandOrControl+P",
      registerAccelerator: false,
      click: actionHandler.quickSearch,
      enabled: false,
    },
    disconnect: {
      id: 'disconnect',
      label: "Disconnect",
      icon: 'power_settings_new',
      accelerator: "Shift+CommandOrControl+Q",
      click: actionHandler.disconnect,
      enabled: false,
    },
    primarySidebarToggle: {
      id: 'menu-toggle-sidebar',
      label: 'Toggle Primary Sidebar',
      icon: 'view_sidebar',
      accelerator: platformInfo.isMac? "CommandOrControl+B" : "Alt+S",
      click: actionHandler.togglePrimarySidebar,
      enabled: false,
    },
    secondarySidebarToggle: {
      id: 'menu-secondary-sidebar',
      label: 'Toggle Secondary Sidebar',
      icon: 'view_sidebar',
      // accelerator: "Alt+S",
      click: actionHandler.toggleSecondarySidebar,  
      enabled: false,
    },
    themeToggle: {
      id: "theme-toggle-menu",
      label: "Theme",
      icon: 'palette',
      submenu: [
        {
          type: 'radio',
          label: "System",
          icon: 'computer',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'system'
        },
        {
          type: "radio",
          label: "Light",
          icon: 'light_mode',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'light'
        },
        {
          type: 'radio',
          label: "Dark",
          icon: 'dark_mode',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'dark'
        },
        {
          type: 'radio',
          label: 'Solarized',
          icon: 'wb_sunny',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'solarized'
        },
        {
          type: 'radio',
          label: 'Solarized Dark',
          icon: 'nightlight',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'solarized-dark'
        },
        {
          type: 'radio',
          label: 'Ocean',
          icon: 'waves',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'ocean'
        },
        {
          type: 'radio',
          label: 'Dracula',
          icon: 'nightlight_round',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'dracula'
        },
        {
          type: 'radio',
          label: 'SSMS',
          icon: 'storage',
          click: actionHandler.switchTheme,
          checked: settings?.theme?.value === 'ssms'
        }
      ]
    },
    enterLicense: {
      id: 'enter-license',
      label: "Manage License Keys",
      icon: 'vpn_key',
      click: actionHandler.enterLicense,

    },
    backupDatabase: {
      id: 'backup-database',
      label: "Create a Database Backup",
      icon: 'backup',
      click: actionHandler.backupDatabase,
      enabled: false,
    },
    restoreDatabase: {
      id: 'restore-database',
      label: "Restore a Database Backup",
      icon: 'restore',
      click: actionHandler.restoreDatabase,
      enabled: false,
    },
    exportTables: {
      id: 'export-tables',
      label: 'Export Data',
      icon: 'download',
      click: actionHandler.exportTables,
      enabled: false,
    },
    updatePin: {
      id: 'update-pin',
      label: 'Update Pin',
      icon: 'lock',
      click: actionHandler.updatePin,
    },
    minimalModeToggle: {
      id: "minimal-mode-toggle",
      label: "Toggle Minimal Mode",
      icon: 'crop_free',
      click: actionHandler.toggleMinimalMode,
    },
    licenseState: {
      id: "license-state",
      label: "DEV Switch License State",
      submenu: [
        { label: ">>> BEWARE: ALL LICENSES WILL BE LOST! <<<" },
        {
          label: "First time install, no license, no trial.",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.firstInstall),
        },
        {
          label: "On a trial license",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.onTrial),
        },
        {
          label: "Trial expired",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.trialExpired),
        },
        {
          label: "On an active paid license",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.activePaidLicense),
        },
        {
          label: "On an expired, lifetime license, that covers this version",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.expiredLifetimeCoversThisVersion),
        },
        {
          label: "On an expired, lifetime license, that covers an earlier version",
          click: (item, win) => actionHandler.switchLicenseState(item, win, DevLicenseState.expiredLifetimeCoversEarlierVersion),
        },
      ],
    },
    toggleBeta: {
      id: "toggle-beta",
      label: "Release Channel",
      icon: 'science',
      submenu: [
        {
          type: 'radio',
          label: 'Stable',
          icon: 'check_circle',
          click: actionHandler.toggleBeta,
          checked: settings?.useBeta?.value == false
        },
        {
          type: 'radio',
          label: 'Beta',
          icon: 'science',
          click: actionHandler.toggleBeta,
          checked: settings?.useBeta?.value == true
        }
      ]
    },
    managePlugins: {
      id: 'manage-plugins',
      label: 'Manage Plugins',
      icon: 'extension',
      click: actionHandler.managePlugins,
    },
  }
}
