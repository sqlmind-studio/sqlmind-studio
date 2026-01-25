import platformInfo from '@/common/platform_info';
import { Command } from '@/lib/db/models';
import { spawn } from 'child_process';
import { state } from '@/handlers/handlerState';

export interface IBackupHandlers {
  'backup/runCommand': ({ command, sId }: { command: Command; sId: string }) => Promise<void>;
  'backup/whichDumpTool': ({ toolName }: { toolName: string }) => Promise<string>;
  'backup/cancelCommand': ({ sId }: { sId: string }) => Promise<boolean>;
}

export const BackupHandlers: IBackupHandlers = {
  'backup/runCommand': async function ({ command, sId }) {
    if (command.isSql) {
      return new Promise<void>(async (resolve, reject) => {
        (await state(sId).connection.query(`${command.mainCommand} ${command.options ? command.options.join(' ') : ''}`))
          .execute()
          .catch((reason) => {
            state(sId).port.postMessage({
              type: 'backupNotif',
              input: {
                text: reason?.message ?? reason ?? 'Something went wrong',
                type: 'error',
              },
            });
            reject();
          })
          .then(async () => {
            if (!command.postCommand) {
              resolve();
            } else {
              await this['backup/runCommand']({ command: command.postCommand, sId });
              resolve();
            }
          });
      });
    }

    state(sId).backupProc = spawn(command.mainCommand, command.options, {
      shell: true,
      env: command.env,
    });

    state(sId).backupProc.stdout.on('data', (chunk) => {
      state(sId).port.postMessage({
        type: 'backupLog',
        input: chunk.toString(),
      });
    });

    state(sId).backupProc.stderr.on('data', (chunk) => {
      state(sId).port.postMessage({
        type: 'backupLog',
        input: chunk.toString(),
      });
    });

    return new Promise<void>((resolve, reject) => {
      state(sId).backupProc.on('error', (err) => {
        state(sId).port.postMessage({
          type: 'backupNotif',
          input: {
            text: err.message,
            type: 'error',
          },
        });

        reject(`Command run error: ${err.message}`);
      });

      state(sId).backupProc.on('close', async (code) => {
        if (code != 0) {
          state(sId).port.postMessage({
            type: 'backupNotif',
            input: {
              text: 'Something went wrong! Check the command logs for details',
              type: 'error',
            },
          });

          reject('Command returned non-zero exit code');
        } else if (!command.postCommand) {
          resolve();
        } else {
          await this['backup/runCommand']({ command: command.postCommand, sId });
          resolve();
        }
        state(sId).backupProc = null;
      });
    });
  },

  'backup/whichDumpTool': async function ({ toolName }) {
    const cmd = `${platformInfo.isWindows ? 'where' : 'which'}`;

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(cmd, [toolName], { shell: true });

      proc.stdout.on('data', (chunk) => {
        if (chunk) {
          const p: string = chunk.toString().trim();
          resolve(p);
        }
      });

      proc.stderr.on('data', (chunk) => {
        reject(chunk.toString());
      });

      proc.on('error', (err) => {
        reject(err as any);
      });

      proc.on('close', (code) => {
        if (code != 0) {
          reject('ERROR: Command exited with errors');
        }
      });
    });
  },

  'backup/cancelCommand': async function ({ sId }) {
    if (state(sId).backupProc) {
      return state(sId).backupProc.kill();
    }
    return true;
  },
};
