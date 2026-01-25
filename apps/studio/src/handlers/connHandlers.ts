import { UserSetting } from '@/common/appdb/models/user_setting';
import { TokenCache } from '@/common/appdb/models/token_cache';
import { SavedConnection } from '@/common/appdb/models/saved_connection';
import { UserPin } from '@/common/appdb/models/UserPin';
import bksConfig from '@/common/bksConfig';
import { waitPromise } from '@/common/utils';
import { IConnection } from '@/common/interfaces/IConnection';
import { DatabaseFilterOptions, ExtendedTableColumn, FilterOptions, NgQueryResult, OrderBy, PrimaryKeyColumn, Routine, SchemaFilterOptions, StreamResults, SupportedFeatures, TableChanges, TableFilter, TableIndex, TableInsert, TableOrView, TablePartition, TableProperties, TableResult, TableTrigger, TableUpdateResult } from '@/lib/db/models';
import { DatabaseElement, IDbConnectionServerConfig } from '@/lib/db/types';
import { AlterPartitionsSpec, AlterTableSpec, CreateTableSpec, dialectFor, IndexAlterations, RelationAlterations, TableKey } from '@shared/lib/dialects/models';
import { SqlGenerator } from '@shared/lib/sql/SqlGenerator';
import { createSqlServerPublicServer } from '@/lib/db/sqlserverPublicServer';
import { checkConnection, errorMessages, getDriverHandler, state } from '@/handlers/handlerState';

export interface IConnectionHandlers {
  'conn/create': ({ config, auth, osUser, sId }: { config: IConnection; auth?: { input: string; mode: 'pin' }; osUser: string; sId: string }) => Promise<void>;
  'conn/test': ({ config, osUser, sId }: { config: IConnection; osUser: string; sId: string }) => Promise<void>;
  'conn/changeDatabase': ({ newDatabase, sId }: { newDatabase: string; sId: string }) => Promise<void>;
  'conn/clearConnection': ({ sId }: { sId: string }) => Promise<void>;
  'conn/getServerConfig': ({ sId }: { sId: string }) => Promise<IDbConnectionServerConfig>;
  'conn/supportedFeatures': ({ sId }: { sId: string }) => Promise<SupportedFeatures>;
  'conn/versionString': ({ sId }: { sId: string }) => Promise<string>;
  'conn/defaultSchema': ({ sId }: { sId: string }) => Promise<string | null>;
  'conn/listCharsets': ({ sId }: { sId: string }) => Promise<string[]>;
  'conn/getDefaultCharset': ({ sId }: { sId: string }) => Promise<string>;
  'conn/listCollations': ({ charset, sId }: { charset: string; sId: string }) => Promise<string[]>;
  'conn/connect': ({ sId }: { sId: string }) => Promise<void>;
  'conn/disconnect': ({ sId }: { sId: string }) => Promise<void>;
  'conn/listTables': ({ filter, sId }: { filter?: FilterOptions; sId: string }) => Promise<TableOrView[]>;
  'conn/listViews': ({ filter, sId }: { filter?: FilterOptions; sId: string }) => Promise<TableOrView[]>;
  'conn/listRoutines': ({ filter, sId }: { filter?: FilterOptions; sId: string }) => Promise<Routine[]>;
  'conn/listMaterializedViewColumns': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<any[]>;
  'conn/listTableColumns': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<ExtendedTableColumn[]>;
  'conn/listTableTriggers': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<TableTrigger[]>;
  'conn/listTableIndexes': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<TableIndex[]>;
  'conn/listSchemas': ({ filter, sId }: { filter?: SchemaFilterOptions; sId: string }) => Promise<string[]>;
  'conn/getTableReferences': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<string[]>;
  'conn/getTableKeys': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<TableKey[]>;
  'conn/listTablePartitions': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<TablePartition[]>;
  'conn/executeCommand': ({ commandText, sId }: { commandText: string; sId: string }) => Promise<NgQueryResult[]>;
  'conn/query': ({ queryText, options, sId }: { queryText: string; options?: any; sId: string }) => Promise<string>;
  'conn/getCompletions': ({ cmd, sId }: { cmd: string; sId: string }) => Promise<string[]>;
  'conn/getShellPrompt': ({ sId }: { sId: string }) => Promise<string>;
  'conn/executeQuery': ({ queryText, options, sId }: { queryText: string; options: any; sId: string }) => Promise<NgQueryResult[]>;
  'conn/listDatabases': ({ filter, sId }: { filter?: DatabaseFilterOptions; sId: string }) => Promise<string[]>;
  'conn/getTableProperties': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<TableProperties | null>;
  'conn/getQuerySelectTop': ({ table, limit, schema, database, sId }: { table: string; limit: number; schema?: string; database?: string; sId: string }) => Promise<string>;
  'conn/listMaterializedViews': ({ filter, sId }: { filter?: FilterOptions; sId: string }) => Promise<TableOrView[]>;
  'conn/getPrimaryKey': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<string | null>;
  'conn/getPrimaryKeys': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<PrimaryKeyColumn[]>;
  'conn/createDatabase': ({ databaseName, charset, collation, sId }: { databaseName: string; charset: string; collation: string; sId: string }) => Promise<string>;
  'conn/createDatabaseSQL': ({ sId }: { sId: string }) => Promise<string>;
  'conn/getTableCreateScript': ({ table, schema, sId }: { table: string; schema?: string; sId: string }) => Promise<string>;
  'conn/getViewCreateScript': ({ view, schema, sId }: { view: string; schema?: string; sId: string }) => Promise<string[]>;
  'conn/getMaterializedViewCreateScript': ({ view, schema, sId }: { view: string; schema?: string; sId: string }) => Promise<string[]>;
  'conn/getRoutineCreateScript': ({ routine, type, schema, sId }: { routine: string; type: string; schema?: string; sId: string }) => Promise<string[]>;
  'conn/createTable': ({ table }: { table: CreateTableSpec }) => Promise<void>;
  'conn/getCollectionValidation': ({ collection, sId }: { collection: string; sId: string }) => Promise<any>;
  'conn/setCollectionValidation': ({ params, sId }: { params: any; sId: string }) => Promise<void>;
  'conn/alterTableSql': ({ change, sId }: { change: AlterTableSpec; sId: string }) => Promise<string>;
  'conn/alterTable': ({ change, sId }: { change: AlterTableSpec; sId: string }) => Promise<void>;
  'conn/alterIndexSql': ({ changes, sId }: { changes: IndexAlterations; sId: string }) => Promise<string | null>;
  'conn/alterIndex': ({ changes, sId }: { changes: IndexAlterations; sId: string }) => Promise<void>;
  'conn/alterRelationSql': ({ changes, sId }: { changes: RelationAlterations; sId: string }) => Promise<string | null>;
  'conn/alterRelation': ({ changes, sId }: { changes: RelationAlterations; sId: string }) => Promise<void>;
  'conn/alterPartitionSql': ({ changes, sId }: { changes: AlterPartitionsSpec; sId: string }) => Promise<string | null>;
  'conn/alterPartition': ({ changes, sId }: { changes: AlterPartitionsSpec; sId: string }) => Promise<void>;
  'conn/applyChangesSql': ({ changes, sId }: { changes: TableChanges; sId: string }) => Promise<string>;
  'conn/applyChanges': ({ changes, sId }: { changes: TableChanges; sId: string }) => Promise<TableUpdateResult[]>;
  'conn/setTableDescription': ({ table, description, schema, sId }: { table: string; description: string; schema?: string; sId: string }) => Promise<string>;
  'conn/setElementName': ({ elementName, newElementName, typeOfElement, schema, sId }: { elementName: string; newElementName: string; typeOfElement: DatabaseElement; schema?: string; sId: string }) => Promise<void>;
  'conn/dropElement': ({ elementName, typeOfElement, schema, sId }: { elementName: string; typeOfElement: DatabaseElement; schema?: string; sId: string }) => Promise<void>;
  'conn/truncateElement': ({ elementName, typeOfElement, schema, sId }: { elementName: string; typeOfElement: DatabaseElement; schema?: string; sId: string }) => Promise<void>;
  'conn/truncateAllTables': ({ schema, sId }: { schema?: string; sId: string }) => Promise<void>;
  'conn/getTableLength': ({ table, schema, database, sId }: { table: string; schema?: string; database?: string; sId: string }) => Promise<number>;
  'conn/selectTop': ({ table, offset, limit, orderBy, filters, schema, selects, database, sId }: { table: string; offset: number; limit: number; orderBy: OrderBy[]; filters: string | TableFilter[]; schema?: string; selects?: string[]; database?: string; sId: string }) => Promise<TableResult>;
  'conn/selectTopSql': ({ table, offset, limit, orderBy, filters, schema, selects, sId }: { table: string; offset: number; limit: number; orderBy: OrderBy[]; filters: string | TableFilter[]; schema?: string; selects?: string[]; sId: string }) => Promise<string>;
  'conn/selectTopStream': ({ table, orderBy, filters, chunkSize, schema, sId }: { table: string; orderBy: OrderBy[]; filters: string | TableFilter[]; chunkSize: number; schema?: string; sId: string }) => Promise<StreamResults>;
  'conn/queryStream': ({ query, chunkSize, sId }: { query: string; chunkSize: number; sId: string }) => Promise<StreamResults>;
  'conn/duplicateTable': ({ tableName, duplicateTableName, schema, sId }: { tableName: string; duplicateTableName: string; schema?: string; sId: string }) => Promise<void>;
  'conn/duplicateTableSql': ({ tableName, duplicateTableName, schema, sId }: { tableName: string; duplicateTableName: string; schema?: string; sId: string }) => Promise<string>;
  'conn/getInsertQuery': ({ tableInsert, runAsUpsert, sId }: { tableInsert: TableInsert; runAsUpsert?: boolean; sId: string }) => Promise<string>;
  'conn/syncDatabase': ({ sId }: { sId: string }) => Promise<void>;
  'conn/getQueryForFilter': ({ filter, sId }: { filter: TableFilter; sId: string }) => Promise<string>;
}

export const ConnHandlers: IConnectionHandlers = {
  'conn/create': async function ({ config, auth, osUser, sId }) {
    if (!osUser) {
      throw new Error(errorMessages.noUsername);
    }

    if (config.connectionType !== 'sqlserver') {
      throw new Error('Only SQL Server connections are supported in this build.');
    }

    if (bksConfig.security.lockMode === 'pin') {
      await waitPromise(1000);
      if (!auth) {
        throw new Error('Authentication is required.');
      }
      if (auth.mode !== 'pin') {
        throw new Error(`Invalid authentication mode: ${auth.mode}`);
      }
      if (!(await UserPin.verifyPin(auth.input))) {
        throw new Error('Incorrect pin. Please try again.');
      }
    }

    if (config.azureAuthOptions?.azureAuthEnabled && !config.authId) {
      let cache = new TokenCache();
      cache = await cache.save();
      config.authId = cache.id;
      if (config.id) {
        const conn = await SavedConnection.findOneBy({ id: config.id });
        if (conn) {
          conn.authId = cache.id;
          conn.save();
        }
      }
    }

    const abortController = new AbortController();
    state(sId).connectionAbortController = abortController;

    const settings = await UserSetting.all();
    const server = createSqlServerPublicServer(config, osUser);
    const connection = await server.createConnection(config.defaultDatabase);

    state(sId).server = server;
    state(sId).usedConfig = config;
    state(sId).connection = connection;
    state(sId).database = config.defaultDatabase;
    state(sId).username = osUser;
    state(sId).generator = new SqlGenerator(dialectFor('sqlserver'), {
      dbConfig: server.getServerConfig(),
      dbName: (connection as any)?.database?.database,
    });
    state(sId).connectionAbortController = null;

    // ensure sql generator exists
    if (!state(sId).generator) {
      throw new Error(errorMessages.noGenerator);
    }

    // prime any optional settings access (keeps parity with legacy behavior)
    void settings;
  },

  'conn/test': async function ({ config, osUser, sId }) {
    if (!osUser) {
      throw new Error(errorMessages.noUsername);
    }

    if (config.connectionType !== 'sqlserver') {
      throw new Error('Only SQL Server connections are supported in this build.');
    }

    const server = createSqlServerPublicServer(config, osUser);
    const abortController = new AbortController();
    state(sId).connectionAbortController = abortController;
    const connection = await server.createConnection(config.defaultDatabase);
    await connection.disconnect();
    server.disconnect();
    state(sId).connectionAbortController = null;
  },

  'conn/changeDatabase': async function ({ newDatabase, sId }) {
    if (!state(sId).server) {
      throw new Error(errorMessages.noServer);
    }
    state(sId).server.destroyConnection(state(sId).database);
    const connection = await state(sId).server.createConnection(newDatabase);
    state(sId).connection = connection;
    state(sId).database = newDatabase;
  },

  'conn/clearConnection': async function ({ sId }) {
    if (state(sId).server) {
      state(sId).server.destroyConnection();
    }
    state(sId).server = null;
    state(sId).connection = null;
    state(sId).database = null;
    state(sId).usedConfig = null;
    state(sId).generator = null;
    state(sId).queries = new Map();
    state(sId).exports = new Map();
    state(sId).imports = new Map();
  },

  'conn/getServerConfig': async function ({ sId }) {
    if (!state(sId).server) {
      throw new Error(errorMessages.noServer);
    }
    return state(sId).server.getServerConfig();
  },

  'conn/supportedFeatures': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.supportedFeatures();
  },

  'conn/versionString': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.versionString();
  },

  'conn/defaultSchema': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.defaultSchema();
  },

  'conn/listCharsets': getDriverHandler('listCharsets'),
  'conn/getDefaultCharset': getDriverHandler('getDefaultCharset'),
  'conn/listCollations': async ({ charset, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listCollations(charset);
  },

  'conn/connect': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.connect();
  },

  'conn/disconnect': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.disconnect();
  },

  'conn/listTables': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listTables(filter);
  },
  'conn/listViews': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listViews(filter);
  },
  'conn/listRoutines': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listRoutines(filter);
  },
  'conn/listMaterializedViewColumns': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listMaterializedViewColumns(table, schema);
  },
  'conn/listTableColumns': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.listTableColumns(table, schema);
  },
  'conn/listTableTriggers': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listTableTriggers(table, schema);
  },
  'conn/listTableIndexes': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.listTableIndexes(table, schema);
  },
  'conn/listSchemas': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listSchemas(filter);
  },
  'conn/getTableReferences': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getTableReferences(table, schema);
  },
  'conn/getTableKeys': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.getTableKeys(table, schema);
  },
  'conn/listTablePartitions': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listTablePartitions(table, schema);
  },

  'conn/executeCommand': async ({ commandText, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.executeCommand(commandText);
  },

  'conn/query': async ({ queryText, options, sId }) => {
    checkConnection(sId);
    const q = await state(sId).connection.query(queryText, options);
    const id = require('@/lib/uuid').uuidv4();
    state(sId).queries.set(id, q);
    return id;
  },

  'conn/getCompletions': async ({ cmd, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getCompletions(cmd);
  },

  'conn/getShellPrompt': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getShellPrompt();
  },

  'conn/executeQuery': async ({ queryText, options, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.executeQuery(queryText, options);
  },

  'conn/listDatabases': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listDatabases(filter);
  },

  'conn/getTableProperties': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.getTableProperties(table, schema);
  },

  'conn/getQuerySelectTop': async ({ table, limit, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.getQuerySelectTop(table, limit, schema);
  },

  'conn/listMaterializedViews': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.listMaterializedViews(filter);
  },

  'conn/getPrimaryKey': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getPrimaryKey(table, schema);
  },

  'conn/getPrimaryKeys': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.getPrimaryKeys(table, schema);
  },

  'conn/createDatabase': async ({ databaseName, charset, collation, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.createDatabase(databaseName, charset, collation);
  },

  'conn/createDatabaseSQL': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.createDatabaseSQL();
  },

  'conn/getTableCreateScript': async ({ table, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getTableCreateScript(table, schema);
  },

  'conn/getViewCreateScript': async ({ view, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getViewCreateScript(view, schema);
  },

  'conn/getMaterializedViewCreateScript': async ({ view, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getMaterializedViewCreateScript(view, schema);
  },

  'conn/getRoutineCreateScript': async ({ routine, type, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getRoutineCreateScript(routine, type, schema);
  },

  'conn/createTable': async ({ table }) => {
    // passed through to DB layer for Mongo; for SQL Server this is no-op
    void table;
  },

  'conn/getCollectionValidation': async ({ collection, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getCollectionValidation(collection);
  },

  'conn/setCollectionValidation': async ({ params, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.setCollectionValidation(params);
  },

  'conn/alterTableSql': async ({ change, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterTableSql(change);
  },

  'conn/alterTable': async ({ change, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterTable(change);
  },

  'conn/alterIndexSql': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterIndexSql(changes);
  },

  'conn/alterIndex': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterIndex(changes);
  },

  'conn/alterRelationSql': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterRelationSql(changes);
  },

  'conn/alterRelation': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterRelation(changes);
  },

  'conn/alterPartitionSql': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterPartitionSql(changes);
  },

  'conn/alterPartition': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.alterPartition(changes);
  },

  'conn/applyChangesSql': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.applyChangesSql(changes);
  },

  'conn/applyChanges': async ({ changes, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.applyChanges(changes);
  },

  'conn/setTableDescription': async ({ table, description, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.setTableDescription(table, description, schema);
  },

  'conn/setElementName': async ({ elementName, newElementName, typeOfElement, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.setElementName(elementName, newElementName, typeOfElement, schema);
  },

  'conn/dropElement': async ({ elementName, typeOfElement, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.dropElement(elementName, typeOfElement, schema);
  },

  'conn/truncateElement': async ({ elementName, typeOfElement, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.truncateElement(elementName, typeOfElement, schema);
  },

  'conn/truncateAllTables': async ({ schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.truncateAllTables(schema);
  },

  'conn/getTableLength': async ({ table, schema, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.getTableLength(table, schema);
  },

  'conn/selectTop': async ({ table, offset, limit, orderBy, filters, schema, selects, database, sId }) => {
    checkConnection(sId);
    void database;
    return await state(sId).connection.selectTop(table, offset, limit, orderBy, filters, schema, selects);
  },

  'conn/selectTopSql': async ({ table, offset, limit, orderBy, filters, schema, selects, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.selectTopSql(table, offset, limit, orderBy, filters, schema, selects);
  },

  'conn/selectTopStream': async ({ table, orderBy, filters, chunkSize, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.selectTopStream(table, orderBy, filters, chunkSize, schema);
  },

  'conn/queryStream': async ({ query, chunkSize, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.queryStream(query, chunkSize);
  },

  'conn/duplicateTable': async ({ tableName, duplicateTableName, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.duplicateTable(tableName, duplicateTableName, schema);
  },

  'conn/duplicateTableSql': async ({ tableName, duplicateTableName, schema, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.duplicateTableSql(tableName, duplicateTableName, schema);
  },

  'conn/getInsertQuery': async ({ tableInsert, runAsUpsert, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getInsertQuery(tableInsert, runAsUpsert);
  },

  'conn/syncDatabase': async ({ sId }) => {
    checkConnection(sId);
    return await state(sId).connection.syncDatabase();
  },

  'conn/getQueryForFilter': async ({ filter, sId }) => {
    checkConnection(sId);
    return await state(sId).connection.getQueryForFilter(filter);
  },
};
