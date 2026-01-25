import type { IConnection } from '@/common/interfaces/IConnection';
import type { IDbConnectionDatabase, IDbConnectionServerConfig } from '@/lib/db/types';
import type { IDbConnectionPublicServer } from '@/lib/db/serverTypes';
import type { IDbConnectionServer } from '@/lib/db/backendTypes';
import createSqlServerClient from '@/lib/db/clients/sqlserver';

function buildSqlServerServerConfig(config: IConnection, osUser: string): IDbConnectionServerConfig {
  const ssh = config.sshEnabled
    ? {
        host: config.sshHost ? config.sshHost.trim() : null,
        port: config.sshPort,
        user: config.sshUsername ? config.sshUsername.trim() : null,
        password: config.sshPassword,
        privateKey: config.sshKeyfile,
        passphrase: config.sshKeyfilePassword,
        bastionHost: config.sshBastionHost,
        useAgent: config.sshMode === 'agent',
        keepaliveInterval: config.sshKeepaliveInterval,
      }
    : null;

  const options = config.options || {};
  if (config.defaultDatabase) {
    options.database = config.defaultDatabase;
  }

  return {
    client: 'sqlserver',
    host: config.host ? config.host.trim() : null,
    port: config.port || 1433,
    domain: config.domain ? config.domain.trim() : null,
    socketPath: config.socketPath,
    socketPathEnabled: !!config.socketPathEnabled,
    user: config.username ? config.username.trim() : null,
    osUser,
    password: config.password,
    ssh,
    sslCaFile: config.sslCaFile,
    sslCertFile: config.sslCertFile,
    sslKeyFile: config.sslKeyFile,
    sslRejectUnauthorized: !!config.sslRejectUnauthorized,
    ssl: !!config.ssl,
    readOnlyMode: !!config.readOnlyMode,
    trustServerCertificate: !!config.trustServerCertificate,
    options,
    azureAuthOptions: config.azureAuthOptions,
    authId: config.authId,
  };
}

export function createSqlServerPublicServer(config: IConnection, osUser: string): IDbConnectionPublicServer {
  const server: IDbConnectionServer = {
    db: {},
    config: buildSqlServerServerConfig(config, osUser),
  };

  const getDbName = (dbName?: string) => dbName || config.defaultDatabase || 'master';

  const createDatabase = (dbName?: string): IDbConnectionDatabase => ({
    database: getDbName(dbName),
    connected: null,
    connecting: false,
    namespace: null,
  });

  const publicServer: IDbConnectionPublicServer = {
    db: (dbName: string) => server.db[getDbName(dbName)] as any,

    async createConnection(dbName?: string, _cryptoSecret?: string) {
      const name = getDbName(dbName);
      if (server.db[name]) {
        return server.db[name] as any;
      }
      const database = createDatabase(name);
      const client = await createSqlServerClient(server, database);
      server.db[name] = client;
      return client as any;
    },

    disconnect() {
      Object.keys(server.db).forEach((k) => {
        try {
          const c: any = server.db[k];
          c?.disconnect?.();
        } catch {
          // ignore
        }
      });
    },

    end() {
      this.disconnect();
    },

    destroyConnection(dbName?: string) {
      const name = dbName ? getDbName(dbName) : null;
      if (name) {
        const c: any = server.db[name];
        try {
          c?.disconnect?.();
        } catch {
          // ignore
        }
        delete server.db[name];
        return;
      }

      Object.keys(server.db).forEach((k) => {
        const c: any = server.db[k];
        try {
          c?.disconnect?.();
        } catch {
          // ignore
        }
        delete server.db[k];
      });
    },

    async versionString() {
      const conn: any = await this.createConnection();
      return await conn.versionString();
    },

    getServerConfig() {
      return server.config;
    },
  };

  return publicServer;
}
