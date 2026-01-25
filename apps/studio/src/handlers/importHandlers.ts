import { TableColumn } from '@/lib/db/models';
import ImportClass from '@/lib/import';
import { checkConnection, errorMessages, state } from '@/handlers/handlerState';
import rawLog from '@bksLogger';

const log = rawLog.scope('ImportHandler');

function getImporter(id: string, sId: string): ImportClass {
  const importer = state(sId).imports.get(id);
  if (!importer) {
    throw new Error(errorMessages.noImport);
  }
  return importer;
}

interface PreviewData {
  data: any[];
  columns: TableColumn[];
}

export interface IImportHandlers {
  'import/init': ({ sId, options }: { sId: string; options: any }) => Promise<string>;
  'import/allowChangeSettings': ({ sId, id }: { sId: string; id: string }) => Promise<any>;
  'import/excel/getSheets': ({ sId, id }: { sId: string; id: string }) => Promise<any>;
  'import/setOptions': ({ sId, id, options }: { sId: string; id: string; options: any }) => Promise<any>;
  'import/getFilePreview': ({ sId, id }: { sId: string; id: string }) => Promise<PreviewData>;
  'import/generateColumnTypesFromFile': ({ sId, id }: { sId: string; id: string }) => Promise<PreviewData>;
  'import/getImportPreview': ({ sId, id }: { sId: string; id: string }) => Promise<any>;
  'import/getFileAttributes': ({ sId, id }: { sId: string; id: string }) => Promise<any>;
  'import/getAutodetectedSettings': ({ sId, id }: { sId: string; id: string }) => Promise<any>;
  'import/mapper': ({ sId, id, dataToMap }: { sId: string; id: string; dataToMap: any[] }) => Promise<any>;
  'import/importFile': ({ sId, id, createTableSql }: { sId: string; id: string; createTableSql: string }) => Promise<any>;
}

export const ImportHandlers: IImportHandlers = {
  'import/init': async function ({ sId, options }) {
    checkConnection(sId);
    const processId = require('@/lib/uuid').uuidv4();

    // Community build currently supports the base Import class contract.
    // Specific file-type importers (csv/xlsx/json/jsonl) can be added later if needed.
    const importer: any = new ImportClass(options?.fileName, options, state(sId).connection, options?.table ?? null);

    log.debug(`Initializing import class at id: ${processId}`);
    state(sId).imports.set(processId, importer);
    return processId;
  },

  'import/allowChangeSettings': async function ({ sId, id }) {
    return getImporter(id, sId).allowChangeSettings();
  },

  'import/excel/getSheets': async function ({ sId, id }) {
    return await getImporter(id, sId).getSheets();
  },

  'import/setOptions': async function ({ sId, options, id }) {
    return getImporter(id, sId).setOptions(options);
  },

  'import/getFilePreview': async function ({ sId, id }) {
    const importer: any = getImporter(id, sId);
    const previewData: any = await importer.getPreview();
    return importer.mapRawData(previewData);
  },

  'import/generateColumnTypesFromFile': async function ({ sId, id }) {
    return await getImporter(id, sId).generateColumnTypesFromFile();
  },

  'import/getImportPreview': async function ({ sId, id }) {
    const importer: any = getImporter(id, sId);
    const { data }: any = await importer.getPreview();
    return importer.mapData(data);
  },

  'import/getFileAttributes': async function ({ sId, id }) {
    return await getImporter(id, sId).getPreview();
  },

  'import/getAutodetectedSettings': async function ({ sId, id }) {
    return getImporter(id, sId).autodetectedSettings();
  },

  'import/mapper': async function ({ sId, id, dataToMap }) {
    return getImporter(id, sId).mapper(dataToMap);
  },

  'import/importFile': async function ({ sId, id, createTableSql }) {
    return await getImporter(id, sId).importFile(createTableSql);
  },
};
