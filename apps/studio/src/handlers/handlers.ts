import { IFileHandlers } from '@/handlers/fileHandlers';
import { IGeneratorHandlers } from '@/handlers/generatorHandlers';
import { IQueryHandlers } from '@/handlers/queryHandlers';
import { ITempHandlers } from '@/handlers/tempHandlers';
import { IConnectionHandlers } from '@/handlers/connHandlers';
import { IExportHandlers } from '@/handlers/exportHandlers';
import { IImportHandlers } from '@/handlers/importHandlers';
import { IBackupHandlers } from '@/handlers/backupHandlers';
import { IEnumHandlers } from '@/handlers/enumHandlers';
import { ILicenseHandlers } from '@/handlers/licenseHandlers';
import { ILockHandlers } from '@/handlers/lockHandlers';
import { ITabHistoryHandlers } from '@/handlers/tabHistoryHandlers';

export interface Handlers extends
  IConnectionHandlers,
  IQueryHandlers,
  IGeneratorHandlers,
  IImportHandlers,
  IExportHandlers,
  IBackupHandlers,
  IFileHandlers,
  IEnumHandlers,
  ITempHandlers,
  ILicenseHandlers,
  ILockHandlers,
  ITabHistoryHandlers
  {}
