import { TableFilter, TableOrView } from '@/lib/db/models';
import { CsvExporter, Export, JsonExporter, JsonLineExporter, SqlExporter } from '@/lib/export';
import { ExportStatus } from '@/lib/export/models';
import { checkConnection, errorMessages, state } from '@/handlers/handlerState';
import { TransportExport } from '@/common/transport/TransportExport';

interface StartExportOptions {
  table: TableOrView;
  query?: string;
  queryName?: string;
  filters: TableFilter[];
  exporter: 'csv' | 'json' | 'sql' | 'jsonl';
  filePath: string;
  options: {
    chunkSize: number;
    deleteOnAbort: boolean;
    includeFilter: boolean;
  };
  outputOptions: any;
  managerNotify: boolean;
}

const ExportClassPicker = {
  csv: CsvExporter,
  json: JsonExporter,
  sql: SqlExporter,
  jsonl: JsonLineExporter,
};

function getExporter(id: string, sId: string): Export {
  const exporter = state(sId).exports.get(id);
  if (!exporter) {
    throw new Error(errorMessages.noExport);
  }
  return exporter;
}

export interface IExportHandlers {
  'export/add': ({ options, sId }: { options: StartExportOptions; sId: string }) => Promise<TransportExport>;
  'export/remove': ({ id, sId }: { id: string; sId: string }) => Promise<void>;
  'export/removeInactive': ({ sId }: { sId: string }) => Promise<TransportExport[]>;
  'export/status': ({ id, sId }: { id: string; sId: string }) => Promise<ExportStatus>;
  'export/error': ({ id, sId }: { id: string; sId: string }) => Promise<Error>;
  'export/name': ({ id, sId }: { id: string; sId: string }) => Promise<string>;
  'export/start': ({ id, sId }: { id: string; sId: string }) => Promise<void>;
  'export/cancel': ({ id, sId }: { id: string; sId: string }) => Promise<void>;
  'export/batch': ({ ids, sId }: { ids: string[]; sId: string }) => Promise<void>;
}

export const ExportHandlers: IExportHandlers = {
  'export/add': async function ({ options, sId }) {
    checkConnection(sId);
    const ExporterClass: any = (ExportClassPicker as any)[options.exporter];
    const exporter = new ExporterClass(
      options.filePath,
      state(sId).connection,
      options.table,
      options.query,
      options.queryName,
      options.filters || [],
      options.options,
      options.outputOptions,
      options.managerNotify,
    );

    state(sId).exports.set(exporter.id, exporter);

    return {
      id: exporter.id,
      status: exporter.status,
      filePath: exporter.filePath,
      percentComplete: exporter.percentComplete,
    };
  },

  'export/remove': async function ({ id, sId }) {
    state(sId).exports.delete(id);
  },

  'export/removeInactive': async function ({ sId }) {
    state(sId).exports = new Map([...state(sId).exports.entries()].filter(([_key, exp]) => exp.status === ExportStatus.Exporting));
    return [...state(sId).exports.entries()].map(([_id, exp]) => ({
      id: exp.id,
      status: exp.status,
      filePath: exp.filePath,
      percentComplete: exp.percentComplete,
    }));
  },

  'export/status': async function ({ id, sId }) {
    return getExporter(id, sId).status;
  },

  'export/error': async function ({ id, sId }) {
    return getExporter(id, sId).error;
  },

  'export/name': async function ({ id, sId }) {
    const exporter: any = getExporter(id, sId);
    return exporter.table ? exporter.table.name : exporter.queryName;
  },

  'export/start': async function ({ id, sId }) {
    const exporter = getExporter(id, sId);

    exporter.onProgress((progress) => {
      state(sId).port.postMessage({
        type: `onExportProgress/${id}`,
        input: progress,
      });
    });

    await exporter.exportToFile();
  },

  'export/cancel': async function ({ id, sId }) {
    return getExporter(id, sId).abort();
  },

  'export/batch': async function ({ ids, sId }) {
    await Promise.all(
      ids.map((id) => {
        const exporter = getExporter(id, sId);
        exporter.onProgress((progress) => {
          state(sId).port.postMessage({
            type: `onExportProgress/${id}`,
            input: progress,
          });
        });
        return exporter.exportToFile();
      }),
    );
  },
};
