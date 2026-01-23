declare module "@sqlmindstudio/plugin" {
  export const getAppInfo: any;
  export const log: any;
  export const addNotificationListener: any;
  export const setDebugComms: any;
  export const openExternal: any;
}

declare module "@sqlmindstudio/plugin/dist/eventForwarder" {
  const _noop: any;
  export default _noop;
}
