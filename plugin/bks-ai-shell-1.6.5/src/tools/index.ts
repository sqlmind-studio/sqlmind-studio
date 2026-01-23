import { z } from "zod";
import { tool, ToolSet } from "ai";
import {
  getColumns,
  getConnectionInfo,
  getTables,
  runQuery,
  openTab,
  notify,
} from "@sqlmindstudio/plugin";
import { safeJSONStringify } from "@/utils";
import { useChatStore } from '@/stores/chat';
import { createProvider } from '@/providers';
import {
  analyze_investigation_question,
  get_system_object_schema,
  generate_investigation_query,
  analyze_investigation_results,
  provide_investigation_recommendations,
  retrieve_investigation_context,
} from './dynamicInvestigation';
import {
  query_builder_select_object,
  query_builder_select_columns,
  query_builder_add_where,
  query_builder_build,
} from './queryBuilder';

// Global guards to prevent duplicate insert_sql calls per assistant turn
let insertSqlExecuting = false; // in-flight mutex
let insertSqlAccepted = false;  // persistent for the whole assistant turn
let getTablesInFlight = false;  // coalesce duplicate get_tables in a turn
let lastGetTablesResult: any | null = null;
let lastTabOpenAt = 0; // ms timestamp when we opened a tab
let lastInsertCompletedAt = 0; // ms timestamp when insert_sql finished
let lastInsertCooldownUntil = 0; // ms timestamp preventing back-to-back inserts
let lastGetQueryTextAt = 0; // ms timestamp when get_query_text last fetched
let lastGetQueryTextValue = '';
let getTabListInFlight = false; // coalesce duplicate get_tab_list in a turn
let lastGetTabListResult: any | null = null;
let lastInsertedSqlContent: string | null = null; // cache the last SQL we attempted to insert
let runCurrentQueryExecutedThisTurn = false; // prevent multiple executions per turn
let openNewTabExecutedThisTurn = false; // prevent opening multiple tabs per turn
let lastInsertBlockLogAt = 0; // debounce noisy blocked logs
// Raw helper-level coalescing for getTabList to avoid spamming host
let rawTabListPromise: Promise<any> | null = null;
let rawTabListLastAt = 0;
const RAW_TABLIST_TTL_MS = 350; // share results for a brief window to coalesce bursts

// CRITICAL: Enforce ONE diagnostic query at a time per AI response
let diagnosticQueryExecutedThisTurn = false; // prevent multiple diagnostic queries per turn
let diagnosticQueryInFlight = false; // prevent parallel execution
let lastSwitchDatabaseAt = 0; // timestamp of last switch_database call

// CRITICAL: Track query count per investigation to enforce a minimum number of queries
let investigationQueryCount = 0; // count of diagnostic queries executed in current investigation

const getMinimumInvestigationQueries = async () => {
  try {
    // Default safety: require enough evidence before concluding.
    const defaultMin = 5;

    // Read mode toggle from configuration.
    let deepInvestigationMode = false;
    try {
      const { useConfigurationStore } = await import('@/stores/configuration');
      deepInvestigationMode = !!useConfigurationStore()?.deepInvestigationMode;
    } catch (_) {
      deepInvestigationMode = false;
    }

    // Detect currently selected provider/model.
    let providerId = '';
    try {
      const { useChatStore } = await import('@/stores/chat');
      const chat = useChatStore();
      providerId = String((chat as any)?.model?.provider || '').trim();
    } catch (_) {
      providerId = '';
    }

    const isAnthropic = providerId === 'anthropic';
    if (!isAnthropic) return defaultMin;

    // Tier-1 Anthropic: reduce query minimum in normal mode to lower TPM.
    // Deep Investigation Mode restores the full minimum.
    return deepInvestigationMode ? 5 : 3;
  } catch {
    return 5;
  }
};

// Cache of system-object schemas fetched via get_system_object_schema during this plugin lifetime.
// Used to enforce schema-first BEFORE the first diagnostic query runs.
const fetchedSystemObjectSchemas = new Set<string>();

const normalizeSystemObjectName = (name: string) => {
  try { return String(name || '').trim().toLowerCase(); } catch { return ''; }
};

const extractReferencedSystemObjects = (sqlText: string): string[] => {
  try {
    const q = String(sqlText || '');
    const matches = q.match(/\b(?:sys|msdb\.dbo|msdb\.sys|INFORMATION_SCHEMA|master\.dbo|master\.sys)\.[A-Za-z0-9_]+\b/gi) || [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
      const n = String(m || '').trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  } catch (_) {
    return [];
  }
};

// Wrap the imported tool so we can record which schemas were fetched.
const get_system_object_schema_cached = tool({
  description: (get_system_object_schema as any)?.description || 'Fetch the actual schema for SQL Server system objects.',
  parameters: (get_system_object_schema as any)?.parameters || z.object({ systemObjects: z.array(z.string()) }),
  execute: async (params: any) => {
    try {
      const list = Array.isArray(params?.systemObjects) ? params.systemObjects : [];
      for (const o of list) {
        const key = normalizeSystemObjectName(o);
        if (key) fetchedSystemObjectSchemas.add(key);
      }
    } catch {}
    // Delegate to the original tool.
    return await (get_system_object_schema as any).execute(params);
  },
});

const parseBaseType = (typeText: string) => {
  const t = String(typeText || '').trim();
  const m = t.match(/^([a-zA-Z0-9_]+)\s*(?:\((.*)\))?$/);
  const base = String(m?.[1] || '').toLowerCase();
  const argsRaw = String(m?.[2] || '').trim();
  const args = argsRaw ? argsRaw.split(',').map((x) => x.trim().toLowerCase()) : [];
  return { base, args };
};

const detectPotentialLoss = (fromType: string, toType: string) => {
  try {
    const a = parseBaseType(fromType);
    const b = parseBaseType(toType);
    if (!a.base || !b.base) return { potentialLoss: false, reason: '' };

    // Same-family precision/scale/length reductions are commonly lossy.
    if (a.base === b.base) {
      if (['datetime2', 'time', 'datetimeoffset'].includes(a.base)) {
        const ap = Number(a.args[0]);
        const bp = Number(b.args[0]);
        if (Number.isFinite(ap) && Number.isFinite(bp) && bp < ap) {
          return { potentialLoss: true, reason: 'reduces fractional seconds precision (ROUNDING can occur)' };
        }
      }

      if (['decimal', 'numeric'].includes(a.base)) {
        const ap = Number(a.args[0]);
        const as = Number(a.args[1]);
        const bp = Number(b.args[0]);
        const bs = Number(b.args[1]);
        if (Number.isFinite(ap) && Number.isFinite(bp) && bp < ap) {
          return { potentialLoss: true, reason: 'reduces precision (overflow or rounding can occur)' };
        }
        if (Number.isFinite(as) && Number.isFinite(bs) && bs < as) {
          return { potentialLoss: true, reason: 'reduces scale (ROUNDING can occur)' };
        }
      }

      if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'].includes(a.base)) {
        const al = a.args[0] === 'max' ? Number.POSITIVE_INFINITY : Number(a.args[0]);
        const bl = b.args[0] === 'max' ? Number.POSITIVE_INFINITY : Number(b.args[0]);
        if (Number.isFinite(al) && Number.isFinite(bl) && bl < al) {
          return { potentialLoss: true, reason: 'reduces length (TRUNCATION can occur)' };
        }
      }
    }

    return { potentialLoss: false, reason: '' };
  } catch {
    return { potentialLoss: false, reason: '' };
  }
};

export const conversion_rules = tool({
  description:
    'SQL Server conversion rules helper. Determines whether a conversion is implicit, explicit-only, or not supported by compiling test T-SQL under SET NOEXEC ON. Also reports likely lossy reductions (precision/scale/length).',
  parameters: z.object({
    fromType: z.string().describe('Source SQL Server data type, e.g. datetime2(4), nvarchar(50), decimal(19,4)'),
    toType: z.string().describe('Target SQL Server data type, e.g. datetime2(3), varchar(20), bigint'),
  }),
  execute: async (params) => {
    try {
      const info: any = await getConnectionInfo();
      const isSqlServer =
        String(info?.databaseType || '').toLowerCase() === 'sqlserver' ||
        String(info?.connectionType || '').toLowerCase() === 'sqlserver';

      if (!isSqlServer) {
        return safeJSONStringify({
          ok: false,
          message: 'conversion_rules is only supported for SQL Server connections.',
        });
      }

      const fromType = String(params.fromType || '').trim();
      const toType = String(params.toType || '').trim();
      if (!fromType || !toType) {
        return safeJSONStringify({ ok: false, message: 'fromType and toType are required.' });
      }

      const { potentialLoss, reason } = detectPotentialLoss(fromType, toType);

      const makeBatch = (body: string) => `SET NOEXEC ON;\nBEGIN TRY\n${body}\nEND TRY\nBEGIN CATCH\n  THROW;\nEND CATCH;\nSET NOEXEC OFF;`;

      const implicitBatch = makeBatch(
        `DECLARE @x ${fromType};\nDECLARE @y ${toType};\nSET @y = @x;\nSELECT 1 AS ok;`,
      );
      const explicitBatch = makeBatch(
        `DECLARE @x ${fromType};\nDECLARE @y ${toType};\nSET @y = CAST(@x AS ${toType});\nSELECT 1 AS ok;`,
      );

      let implicitAllowed = false;
      let explicitAllowed = false;
      let implicitError: string | null = null;
      let explicitError: string | null = null;

      try {
        await runQuery(implicitBatch);
        implicitAllowed = true;
      } catch (e: any) {
        implicitAllowed = false;
        implicitError = e?.message ? String(e.message) : String(e);
      }

      try {
        await runQuery(explicitBatch);
        explicitAllowed = true;
      } catch (e: any) {
        explicitAllowed = false;
        explicitError = e?.message ? String(e.message) : String(e);
      }

      let classification: 'implicit' | 'explicit_only' | 'not_supported' = 'not_supported';
      if (implicitAllowed) classification = 'implicit';
      else if (explicitAllowed) classification = 'explicit_only';

      return safeJSONStringify({
        ok: true,
        fromType,
        toType,
        classification,
        implicitAllowed,
        explicitAllowed,
        potentialLoss,
        potentialLossReason: reason || null,
        implicitError,
        explicitError,
      });
    } catch (e: any) {
      return safeJSONStringify({
        ok: false,
        type: 'error',
        message: e?.message ? String(e.message) : String(e),
      });
    }
  },
});

export function resetInsertSqlGuard() {
  // Call this at the start of a new user turn to allow insert_sql again
  insertSqlExecuting = false;
  insertSqlAccepted = false;
  getTablesInFlight = false;
  lastGetTablesResult = null;
  getTabListInFlight = false;
  lastGetTabListResult = null;
  lastInsertedSqlContent = null;
  runCurrentQueryExecutedThisTurn = false;
  
  // Reset investigation query counter for new user turn
  investigationQueryCount = 0;
  openNewTabExecutedThisTurn = false;
  diagnosticQueryExecutedThisTurn = false;
  diagnosticQueryInFlight = false;
}

// Expose active database as a tool for the AI auto-chain
export const get_active_database = tool({
  description: "Get the currently selected database name from the host application.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const db = await getActiveDatabase();
      if (db && db.trim()) {
        return safeJSONStringify({ success: true, database: db });
      }
    } catch (e) {
      // fall through to SQL fallback
    }
    // Fallback: ask the database directly
    try {
      const res: any = await runQuery('SELECT DB_NAME() AS name');
      // Try a few common result shapes
      const row = res?.rows?.[0] || res?.results?.[0]?.rows?.[0] || null;
      const name = row ? (row.name || row.c0 || row["DB_NAME()"] || '') : '';
      if (name && String(name).trim()) {
        return safeJSONStringify({ success: true, database: String(name).trim(), source: 'fallback' });
      }
      return safeJSONStringify({ success: false, database: '', message: 'No database name found in fallback query result' });
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      return safeJSONStringify({ success: false, database: '', message: 'Failed to get active database: ' + msg2 });
    }
  },
});

// Fetch CREATE definition for a routine/view/function by name (SQL Server)
export const get_object_definition = tool({
  description: "Get the CREATE statement (definition) for a stored procedure, view, or function by schema and name (SQL Server).",
  parameters: z.object({
    name: z.string().describe('The object name, e.g., uspSearchCandidateResumes'),
    schema: z.string().nullable().describe('Optional schema, default dbo. Use null to omit.'),
  }),
  execute: async (params) => {
    try {
      const safe = (s?: string) => (s || '').replace(/'/g, "''");
      const schema = params.schema && params.schema.trim() ? params.schema.trim() : 'dbo';
      const name = params.name.trim();
      if (!name) return safeJSONStringify({ type: 'error', message: 'name is required' });
      const sql = `SELECT s.name AS schema_name, o.name AS object_name, sm.definition
FROM sys.sql_modules sm
JOIN sys.objects o ON o.object_id = sm.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE s.name = '${safe(schema)}' AND o.name = '${safe(name)}'`;
      // Return raw result to keep parity with other tools; the assistant can extract the definition
      const res = await runQuery(sql);
      return safeJSONStringify(res);
    } catch (e) {
      return safeJSONStringify({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
});

// Overwrite editor content in the active query tab
async function setQueryText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      let timeoutId: NodeJS.Timeout | null = null;
      const handler = (ev: MessageEvent) => {
        try {
          const anyEv: any = ev as any;
          const data = anyEv?.data || anyEv?.detail || {};
          if (data?.type === 'setQueryText:response' && data?.requestId === requestId) {
            window.removeEventListener('message', handler as any);
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            if (data?.success) return resolve();
            return reject(new Error(data?.error || 'setQueryText failed'));
          }
        } catch { /* ignore */ }
      };
      window.addEventListener('message', handler as any, { once: false });
      console.log('[setQueryText] Sending request to parent window:', requestId);
      window.parent?.postMessage({ type: 'setQueryText', requestId, text }, '*');
      // Safety timeout so we never hang if host doesn't implement setQueryText
      timeoutId = setTimeout(() => {
        try { window.removeEventListener('message', handler as any); } catch {}
        reject(new Error('Timeout waiting for setQueryText response'));
      }, 2500);
    } catch (e) {
      reject(e);
    }
  });
}

function mergeSchemas(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  try {
    return { ...(a || {}), ...(b || {}) };
  } catch (_) {
    return a || b || {};
  }
}

function normalizeObjectList(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list || []) {
    const n = String(raw || '').trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

// Wrapper function to get the currently selected database name
async function getActiveDatabase(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      const message = { id: requestId, name: 'getActiveDatabase', args: {} };

      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          if (resolved) return;
          resolved = true;
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get active database'));
          } else {
            const db = (event.data.result && (event.data.result.database || event.data.result.name)) || '';
            resolve(db || '');
          }
        }
      };

      window.addEventListener('message', responseHandler);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for active database'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get active database: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Small sleep utility
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Wrapper function to get execution plan from active query tab
async function getExecutionPlan(): Promise<{ planXml: string | null; planXmls: string[] | null }> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getExecutionPlan',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get execution plan'));
          } else {
            resolve(event.data.result || { planXml: null, planXmls: null });
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for execution plan'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get execution plan: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get statistics data from active query tab
async function getStatisticsData(): Promise<{ statsData: string | null }> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getStatisticsData',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get statistics data'));
          } else {
            resolve(event.data.result || { statsData: null });
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for statistics data'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get statistics data: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get messages data from active query tab
async function getMessagesData(): Promise<{ messages: any[] | null }> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getMessagesData',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get messages data'));
          } else {
            resolve(event.data.result || { messages: null });
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for messages data'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get messages data: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get execution plan and statistics from a specific tab
async function getTabExecutionData(tabId: number): Promise<{ planXml: string | null; planXmls: string[] | null; statsData: string | null }> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getTabExecutionData',
        args: { tabId }
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get tab execution data'));
          } else {
            resolve(event.data.result || { planXml: null, planXmls: null, statsData: null });
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for tab execution data'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get tab execution data: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get query text from the active query tab
async function getQueryText(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getQueryText',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[getQueryText] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to get query text'));
          } else {
            console.log('[getQueryText] Received successful response');
            resolve(event.data.result || '');
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[getQueryText] Sending request to parent window:', requestId);
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[getQueryText] Request timed out after 3 seconds');
          reject(new Error('Timeout waiting for query text - the query tab might not be responding'));
        }, 3000); // Increased timeout to 3 seconds
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[getQueryText] Exception:', e);
      reject(new Error('Failed to get query text: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get query text with cursor position
async function getQueryTextWithCursor(): Promise<{ text: string; cursorIndex: number }> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getQueryTextWithCursor',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to get query text with cursor'));
          } else {
            resolve(event.data.result || { text: '', cursorIndex: 0 });
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout waiting for query text with cursor'));
        }, 2000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to get query text with cursor: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to insert text at cursor position
async function insertTextAtCursor(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'insertTextAtCursor',
        args: { text }
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            reject(new Error(event.data.error.message || 'Failed to insert text at cursor'));
          } else {
            resolve();
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          reject(new Error('Timeout inserting text at cursor'));
        }, 2000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      reject(new Error('Failed to insert text at cursor: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to insert text into the query editor
// Uses insertText API to insert into current active query tab
async function insertText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      console.log('insertText called with:', text);
      
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      // Use insertText API to insert into active query tab
      const message = {
        id: requestId,
        name: 'insertText',
        args: {
          text: text
        }
      };
      
      console.log('Sending insertText message:', message);
      
      // Set up response listener
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          console.log('Received response:', event.data);
          
          // Clear timeout since we got a response
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return; // Already handled
          resolved = true;
          
          if (event.data.error) {
            // If insertText fails (no active query tab), fall back to openTab
            console.log('insertText failed, falling back to openTab');
            createNewTab(text).then(resolve).catch(reject);
          } else {
            console.log('insertText succeeded!');
            resolve();
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      // Send message to parent window
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        
        // Timeout after 2 seconds
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return; // Already handled
          resolved = true;
          
          // If no response, try creating new tab
          console.log('insertText timeout, falling back to openTab');
          createNewTab(text).then(resolve).catch(reject);
        }, 2000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('insertText error:', e);
      reject(new Error('Failed to insert SQL: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Helper function to create a new query tab
function createNewTab(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random()}`;
    
    const message = {
      id: requestId,
      name: 'openTab',
      args: {
        type: 'query',
        query: text
      }
    };
    
    console.log('Sending openTab message:', message);
    
    const responseHandler = (event: MessageEvent) => {
      if (event.data && event.data.id === requestId) {
        window.removeEventListener('message', responseHandler);
        console.log('Received openTab response:', event.data);
        
        if (event.data.error) {
          reject(new Error(event.data.error.message || 'Failed to create query tab'));
        } else {
          // mark when a tab was opened to help downstream tab-list race handling
          try { lastTabOpenAt = Date.now(); } catch {}
          resolve();
        }
      }
    };
    
    window.addEventListener('message', responseHandler);
    
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*');
      
      setTimeout(() => {
        window.removeEventListener('message', responseHandler);
        resolve();
      }, 5000);
    } else {
      reject(new Error('Unable to communicate with main app'));
    }
  });
}

export const get_tables = tool({
  description: "Get a list of all tables in the current database",
  parameters: z.object({
    schema: z.string().nullable().describe("The name of the schema to get tables for. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      // If another call is in flight, wait briefly for its result to coalesce
      if (getTablesInFlight) {
        for (let i = 0; i < 20; i++) { // up to ~1s
          if (lastGetTablesResult) {
            console.log('[get_tables] Coalesced - returning cached result');
            return safeJSONStringify(lastGetTablesResult);
          }
          await new Promise(r => setTimeout(r, 50));
        }
        // Fallback after waiting: proceed to fetch
        console.warn('[get_tables] Coalescing wait timed out; proceeding to fetch');
      }
      getTablesInFlight = true;
      const res = await getTables(params.schema ?? undefined);
      lastGetTablesResult = res;
      return safeJSONStringify(res);
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      getTablesInFlight = false;
    }
  },
});

export const get_columns = tool({
  description: "Get all columns for a specific table including name and data type",
  parameters: z.object({
    table: z.string().describe("The name of the table to get columns for"),
    schema: z.string().nullable().describe("The name of the schema of the table. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      return safeJSONStringify(await getColumns(params.table, params.schema ?? undefined));
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const validate_query = tool({
  description:
    "Validate a query without executing it (when supported). Use this before presenting runnable SQL.",
  parameters: z.object({
    query: z.string().describe("The SQL query to validate"),
  }),
  execute: async (params) => {
    try {
      const info: any = await getConnectionInfo();
      const isSqlServer =
        String(info?.databaseType || '').toLowerCase() === 'sqlserver' ||
        String(info?.connectionType || '').toLowerCase() === 'sqlserver';

      if (isSqlServer) {
        const q = String(params.query || '');
        const wrapped = `SET NOEXEC ON;\n${q}\n;\nSET NOEXEC OFF;`;
        await runQuery(wrapped);
        return safeJSONStringify({ ok: true });
      }

      return safeJSONStringify({
        ok: false,
        message:
          'Query validation is not supported for this database type. Run it manually to verify.',
      });
    } catch (e) {
      return safeJSONStringify({
        ok: false,
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

// Generalized metadata discovery for SQL Server (read-only)
export const get_db_objects = tool({
  description: `Read database metadata objects (SQL Server): tables, views, procedures, functions, indexes, keys, schemas, sequences, synonyms, statistics, triggers, etc.

⚠️ IMPORTANT: This tool lists OBJECTS within the current database, NOT databases themselves.
⚠️ To list databases, use get_active_database or switch_database tools.
⚠️ This tool only works with object types like tables, views, procedures, etc.`,
  parameters: z.object({
    objectType: z.enum([
      'tables','views','procedures','scalar_functions','table_valued_functions','functions',
      'schemas','indexes','primary_keys','foreign_keys','unique_constraints','check_constraints','default_constraints',
      'sequences','synonyms','statistics','triggers'
    ]).describe('The category of metadata to list (NOT databases - use get_active_database for that)'),
    schema: z.string().nullable().describe('Optional schema filter. Use null to omit.'),
    limit: z.number().int().positive().max(5000).nullable().describe('Optional max rows (default 500). Use null to omit.'),
  }),
  execute: async (params) => {
    const limit = params.limit ?? 500;
    const safeSchema = (s?: string) => (s ? s.replace(/'/g, "''") : undefined);
    const schemaFilter = params.schema ? `WHERE s.name = '${safeSchema(params.schema)}'` : '';
    // Map each object type to a T-SQL query against system catalogs
    const queries: Record<string, string> = {
      tables: `SELECT TOP(${limit}) s.name AS schema_name, t.name AS name, 'TABLE' AS type
               FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
               ${schemaFilter}
               ORDER BY s.name, t.name`,
      views: `SELECT TOP(${limit}) s.name AS schema_name, v.name AS name, 'VIEW' AS type
              FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
              ${schemaFilter}
              ORDER BY s.name, v.name`,
      procedures: `SELECT TOP(${limit}) s.name AS schema_name, p.name AS name, 'PROCEDURE' AS type
                   FROM sys.procedures p JOIN sys.schemas s ON s.schema_id = p.schema_id
                   ${schemaFilter}
                   ORDER BY s.name, p.name`,
      scalar_functions: `SELECT TOP(${limit}) s.name AS schema_name, o.name AS name, o.type AS type
                         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                         WHERE o.type IN ('FN','FS') ${params.schema ? `AND s.name = '${safeSchema(params.schema)}'` : ''}
                         ORDER BY s.name, o.name`,
      table_valued_functions: `SELECT TOP(${limit}) s.name AS schema_name, o.name AS name, o.type AS type
                               FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                               WHERE o.type IN ('TF','IF','FT') ${params.schema ? `AND s.name = '${safeSchema(params.schema)}'` : ''}
                               ORDER BY s.name, o.name`,
      functions: `SELECT TOP(${limit}) s.name AS schema_name, o.name AS name, o.type AS type
                  FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
                  WHERE o.type IN ('FN','FS','TF','IF','FT') ${params.schema ? `AND s.name = '${safeSchema(params.schema)}'` : ''}
                  ORDER BY s.name, o.name`,
      schemas: `SELECT TOP(${limit}) s.name AS schema_name, s.schema_id AS id, 'SCHEMA' AS type
                FROM sys.schemas s
                ${schemaFilter}
                ORDER BY s.name`,
      indexes: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, i.name AS name, i.type_desc AS type
                FROM sys.indexes i
                JOIN sys.tables t ON t.object_id = i.object_id
                JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                WHERE i.index_id > 0 ${params.schema ? `AND sch.name = '${safeSchema(params.schema)}'` : ''}
                ORDER BY sch.name, t.name, i.name`,
      primary_keys: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, kc.name AS name, 'PRIMARY KEY' AS type
                     FROM sys.key_constraints kc
                     JOIN sys.tables t ON t.object_id = kc.parent_object_id
                     JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                     WHERE kc.type = 'PK' ${params.schema ? `AND sch.name = '${safeSchema(params.schema)}'` : ''}
                     ORDER BY sch.name, t.name, kc.name`,
      foreign_keys: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, fk.name AS name, 'FOREIGN KEY' AS type
                     FROM sys.foreign_keys fk
                     JOIN sys.tables t ON t.object_id = fk.parent_object_id
                     JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                     ${params.schema ? `WHERE sch.name = '${safeSchema(params.schema)}'` : ''}
                     ORDER BY sch.name, t.name, fk.name`,
      unique_constraints: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, kc.name AS name, 'UNIQUE' AS type
                           FROM sys.key_constraints kc
                           JOIN sys.tables t ON t.object_id = kc.parent_object_id
                           JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                           WHERE kc.type = 'UQ' ${params.schema ? `AND sch.name = '${safeSchema(params.schema)}'` : ''}
                           ORDER BY sch.name, t.name, kc.name`,
      check_constraints: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, c.name AS name, 'CHECK' AS type
                          FROM sys.check_constraints c
                          JOIN sys.tables t ON t.object_id = c.parent_object_id
                          JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                          ${params.schema ? `WHERE sch.name = '${safeSchema(params.schema)}'` : ''}
                          ORDER BY sch.name, t.name, c.name`,
      default_constraints: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, dc.name AS name, 'DEFAULT' AS type
                            FROM sys.default_constraints dc
                            JOIN sys.tables t ON t.object_id = dc.parent_object_id
                            JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                            ${params.schema ? `WHERE sch.name = '${safeSchema(params.schema)}'` : ''}
                            ORDER BY sch.name, t.name, dc.name`,
      sequences: `SELECT TOP(${limit}) s.name AS schema_name, seq.name AS name, 'SEQUENCE' AS type
                  FROM sys.sequences seq JOIN sys.schemas s ON s.schema_id = seq.schema_id
                  ${schemaFilter}
                  ORDER BY s.name, seq.name`,
      synonyms: `SELECT TOP(${limit}) s.name AS schema_name, syn.name AS name, syn.base_object_name
                 FROM sys.synonyms syn JOIN sys.schemas s ON s.schema_id = syn.schema_id
                 ${schemaFilter}
                 ORDER BY s.name, syn.name`,
      statistics: `SELECT TOP(${limit}) sch.name AS schema_name, t.name AS table_name, st.name AS name
                   FROM sys.stats st
                   JOIN sys.tables t ON t.object_id = st.object_id
                   JOIN sys.schemas sch ON sch.schema_id = t.schema_id
                   ${params.schema ? `WHERE sch.name = '${safeSchema(params.schema)}'` : ''}
                   ORDER BY sch.name, t.name, st.name`,
      triggers: `SELECT TOP(${limit}) s.name AS schema_name, o.name AS parent, tr.name AS name, 'TRIGGER' AS type
                 FROM sys.triggers tr
                 JOIN sys.objects o ON o.object_id = tr.parent_id
                 JOIN sys.schemas s ON s.schema_id = o.schema_id
                 ${params.schema ? `WHERE s.name = '${safeSchema(params.schema)}'` : ''}
                 ORDER BY s.name, o.name, tr.name`,
    };
    const sql = queries[params.objectType];
    if (!sql) {
      return safeJSONStringify({ success: false, unsupported: true, message: 'Unsupported objectType' });
    }
    try {
      const res = await runQuery(sql);
      return safeJSONStringify(res);
    } catch (e) {
      return safeJSONStringify({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  },
});

export const run_query = (
  onAskPermission: (toolCallId: string, params: any) => Promise<boolean>,
) =>
  tool({
    description: "🚨 CHAT MODE ONLY 🚨 Run a SQL query and get the results in chat. This tool is ONLY available in CHAT MODE. In CODE MODE, this tool DOES NOT EXIST - use run_current_query instead. After this tool returns results, you MUST analyze them and provide recommendations.",
    parameters: z.object({
      query: z.string().describe("The SQL query to execute"),
    }),
    execute: async (params, options) => {
      // This tool is intended for Chat Mode. Emit a warning only if output mode indicates Code Mode.
      try {
        const outputMode = String((options as any)?.outputMode || '').toLowerCase();
        if (outputMode && outputMode !== 'chat') {
          console.warn('[run_query] run_query called while outputMode is not chat:', { outputMode });
          console.warn('[run_query] If you are in Code Mode, use insert_sql + run_current_query instead!');
        } else {
          console.log('[run_query] Running query in chat mode');
        }
      } catch (_) {}
      
      const permitted = await onAskPermission(options.toolCallId, params);
      if (!permitted) {
        console.log('[run_query] User declined to run the query');
        return safeJSONStringify({
          type: "user_declined",
          message: "User declined to run this query. Acknowledge their decision and ask what they'd like to do instead.",
        });
      }

      const isShowPlanXml = (v: any) => {
        if (typeof v !== 'string') return false;
        const s = v.trim();
        if (!s) return false;
        if (s.startsWith('<ShowPlanXML')) return true;
        if (s.startsWith('<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"')) return true;
        return false;
      };

      const compactRunQueryResult = (value: any) => {
        try {
          const MAX_JSON_CHARS_DEFAULT = 60_000;
          const MAX_ROWS_DEFAULT = 200;
          const MAX_CELL_CHARS_DEFAULT = 400;

          const detectPlanColumns = (rs: any) => {
            const planIndexes: number[] = [];
            const planKeys: string[] = [];

            const fields = Array.isArray(rs?.fields) ? rs.fields : [];
            for (let i = 0; i < fields.length; i++) {
              const name = String(fields[i]?.name || '').trim();
              if (name && /(^|\b)(query[_\s-]?plan)(\b|$)/i.test(name)) {
                planIndexes.push(i);
                planKeys.push(name);
              }
            }

            if (planIndexes.length === 0 && Array.isArray(rs?.rows)) {
              for (const row of rs.rows) {
                if (Array.isArray(row)) {
                  for (let i = 0; i < row.length; i++) {
                    if (isShowPlanXml(row[i])) {
                      planIndexes.push(i);
                    }
                  }
                } else if (row && typeof row === 'object') {
                  for (const k of Object.keys(row)) {
                    if (/^query[_\s-]?plan$/i.test(String(k))) {
                      planKeys.push(k);
                    } else if (isShowPlanXml((row as any)[k])) {
                      planKeys.push(k);
                    }
                  }
                }
                if (planIndexes.length || planKeys.length) break;
              }
            }

            return {
              hasPlan: planIndexes.length > 0 || planKeys.length > 0,
              planIndexes: Array.from(new Set(planIndexes)),
              planKeys: Array.from(new Set(planKeys)),
            };
          };

          const scrubRow = (row: any, planInfo: { planIndexes: number[]; planKeys: string[] }) => {
            const planIndexes = planInfo.planIndexes;
            const planKeys = planInfo.planKeys;

            const summarizeCell = (v: any) => {
              if (!isShowPlanXml(v)) return v;
              const len = typeof v === 'string' ? v.length : 0;
              return `<<ShowPlanXML omitted: ${len} chars>>`;
            };

            if (Array.isArray(row)) {
              const out = row.slice();
              for (const idx of planIndexes) {
                if (idx >= 0 && idx < out.length) out[idx] = summarizeCell(out[idx]);
              }
              return out;
            }
            if (row && typeof row === 'object') {
              const out: any = { ...row };
              for (const k of planKeys) {
                if (k in out) out[k] = summarizeCell(out[k]);
              }
              for (const k of Object.keys(out)) {
                if (isShowPlanXml(out[k])) out[k] = summarizeCell(out[k]);
              }
              return out;
            }
            return summarizeCell(row);
          };

          const truncateCell = (v: any, maxCellChars: number) => {
            if (typeof v !== 'string') return v;
            if (v.length <= maxCellChars) return v;
            return v.slice(0, maxCellChars) + '…';
          };

          const cloneRow = (row: any, maxCellChars: number, planInfo: { planIndexes: number[]; planKeys: string[] }) => {
            const scrubbed = scrubRow(row, planInfo);
            if (Array.isArray(scrubbed)) return scrubbed.map((v) => truncateCell(v, maxCellChars));
            if (scrubbed && typeof scrubbed === 'object') {
              const out: any = {};
              for (const k of Object.keys(scrubbed)) out[k] = truncateCell((scrubbed as any)[k], maxCellChars);
              return out;
            }
            return truncateCell(scrubbed, maxCellChars);
          };

          const compact = (obj: any, maxRows: number, maxCellChars: number) => {
            if (!obj || typeof obj !== 'object') return obj;
            if (!Array.isArray(obj.results)) return obj;
            const out: any = { ...obj };

            let anyPlan = false;

            out.results = obj.results.map((rs: any) => {
              if (!rs || typeof rs !== 'object') return rs;

              const planInfo = detectPlanColumns(rs);
              if (planInfo.hasPlan) anyPlan = true;

              const rsOut: any = { ...rs };
              if (Array.isArray(rs.rows)) {
                const originalRowCount = rs.rows.length;
                if (originalRowCount > maxRows) {
                  rsOut.rows = rs.rows.slice(0, maxRows).map((r: any) => cloneRow(r, maxCellChars, planInfo));
                  rsOut.truncated = true;
                  rsOut.originalRowCount = originalRowCount;
                } else {
                  rsOut.rows = rs.rows.map((r: any) => cloneRow(r, maxCellChars, planInfo));
                }
              }

              if (planInfo.hasPlan) {
                let omittedCount = 0;
                let omittedChars = 0;
                try {
                  const rows = Array.isArray(rs?.rows) ? rs.rows : [];
                  for (const row of rows) {
                    if (Array.isArray(row)) {
                      for (const idx of planInfo.planIndexes) {
                        const v = row?.[idx];
                        if (isShowPlanXml(v)) {
                          omittedCount++;
                          omittedChars += String(v).length;
                        }
                      }
                    } else if (row && typeof row === 'object') {
                      for (const k of Object.keys(row)) {
                        const v = (row as any)[k];
                        if (isShowPlanXml(v)) {
                          omittedCount++;
                          omittedChars += String(v).length;
                        }
                      }
                    }
                  }
                } catch (_) {}

                rsOut.queryPlanOmitted = {
                  omittedCount,
                  omittedChars,
                  detectedColumns: {
                    byName: planInfo.planKeys,
                    byIndex: planInfo.planIndexes,
                  },
                };
              }

              return rsOut;
            });

            out._compactMeta = {
              anyPlan,
            };

            return out;
          };

          let maxRows = MAX_ROWS_DEFAULT;
          let maxCellChars = MAX_CELL_CHARS_DEFAULT;
          let out = compact(value, maxRows, maxCellChars);

          const anyPlan = !!(out as any)?._compactMeta?.anyPlan;
          const maxJsonChars = anyPlan ? 20_000 : MAX_JSON_CHARS_DEFAULT;
          if (anyPlan) {
            maxRows = 25;
            maxCellChars = 250;
            out = compact(value, maxRows, maxCellChars);
          }

          let len = 0;
          try {
            len = JSON.stringify(out).length;
          } catch {
            len = maxJsonChars + 1;
          }

          if (len > maxJsonChars) {
            const fallbackRows = anyPlan ? 10 : 50;
            out = compact(value, fallbackRows, anyPlan ? 200 : maxCellChars);
            (out as any).truncated = true;
          }

          try {
            if (out && typeof out === 'object' && '_compactMeta' in out) {
              delete (out as any)._compactMeta;
            }
          } catch (_) {}

          return out;
        } catch (_) {
          return value;
        }
      };
      
      try {
        const results = await runQuery(params.query);
        console.log('[run_query] Query executed successfully, results:', results);
        console.log('[run_query] ⚠️ REMINDER: You MUST now analyze these results and provide recommendations. DO NOT stop here!');
        return safeJSONStringify(compactRunQueryResult(results));
      } catch (e) {
        return safeJSONStringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
  });

// ============================================================================
// USER TABLE SCHEMA TOOL: Safe metadata fetching for Chat AI
// ============================================================================
export const get_user_table_schema = tool({
  description: `📋 USER TABLE SCHEMA TOOL - Fetch metadata (columns, indexes, statistics) for user tables to provide recommendations.
  
  ⚠️ SAFETY RESTRICTIONS (ENFORCED):
  - Fetches METADATA ONLY (columns, data types, indexes, statistics, constraints)
  - NO DATA ACCESS - cannot SELECT actual rows from user tables
  - Read-only metadata queries using INFORMATION_SCHEMA and sys catalog views
  - Executes immediately without user permission (metadata is safe)
  
  📊 USE THIS TOOL TO:
  - Analyze table structure for index recommendations
  - Check existing indexes before recommending new ones
  - Review column data types and constraints
  - Examine statistics freshness (rows, modification_counter)
  - Identify missing indexes for slow queries
  
  🚨 WHEN TO USE:
  - After finding slow queries in sys.dm_exec_requests
  - When recommending indexes (check existing indexes first!)
  - When analyzing query performance issues
  - Before suggesting schema changes
  
  ⚠️ CRITICAL: This tool fetches metadata only. Use run_diagnostic_query for system DMV queries.`,
  parameters: z.object({
    tableName: z.string().describe("The table name (e.g., 'Orders', 'Customers')"),
    schemaName: z.string().nullable().describe("The schema name (default: 'dbo'). Use null to omit."),
    includeIndexes: z.boolean().nullable().describe("Include index information (default: true). Use null to omit."),
    includeStatistics: z.boolean().nullable().describe("Include statistics information (default: true). Use null to omit."),
  }),
  execute: async (params) => {
    try {
      // Handle table names with schema prefix (e.g., "Sales.SalesOrderHeader" or "dbo.Sales.SalesOrderHeader")
      let schema = params.schemaName || 'dbo';
      let table = params.tableName;
      
      // If tableName contains a dot, it has a schema prefix
      if (table.includes('.')) {
        const parts = table.split('.');
        if (parts.length === 2) {
          // Format: "Schema.Table"
          schema = parts[0];
          table = parts[1];
        } else if (parts.length === 3) {
          // Format: "dbo.Schema.Table" - strip the first "dbo." prefix
          schema = parts[1];
          table = parts[2];
        }
      }
      
      const includeIndexes = params.includeIndexes !== false;
      const includeStatistics = params.includeStatistics !== false;
      
      console.log(`[get_user_table_schema] Fetching metadata for ${schema}.${table}`);
      
      const metadata: any = {
        schema,
        table,
        columns: [],
        indexes: [],
        statistics: null,
      };
      
      // 1. Fetch column information
      const columnQuery = `
        SELECT 
          c.COLUMN_NAME as name,
          c.DATA_TYPE as dataType,
          c.CHARACTER_MAXIMUM_LENGTH as maxLength,
          c.NUMERIC_PRECISION as precision,
          c.NUMERIC_SCALE as scale,
          c.IS_NULLABLE as isNullable,
          c.COLUMN_DEFAULT as defaultValue
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'
          AND c.TABLE_NAME = '${table.replace(/'/g, "''")}'
        ORDER BY c.ORDINAL_POSITION
      `;
      
      const columnResult = await runQuery(columnQuery);
      metadata.columns = columnResult?.rows || columnResult?.results?.[0]?.rows || [];
      
      // 2. Fetch index information
      if (includeIndexes) {
        const indexQuery = `
SELECT 
    i.name AS indexName,
    i.type_desc AS indexType,
    i.is_unique AS isUnique,
    i.is_primary_key AS isPrimaryKey,
    STUFF((
        SELECT ', ' + c2.name
        FROM sys.index_columns ic2
        JOIN sys.columns c2
            ON ic2.object_id = c2.object_id
           AND ic2.column_id = c2.column_id
        WHERE ic2.object_id = i.object_id
          AND ic2.index_id = i.index_id
          AND ic2.is_included_column = 0
        ORDER BY ic2.key_ordinal
        FOR XML PATH(''), TYPE
    ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS keyColumns,
    i.fill_factor AS [fillFactor],
    CASE WHEN i.type = 1 THEN 'CLUSTERED' ELSE 'NONCLUSTERED' END AS clusteredType
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE s.name = '${schema.replace(/'/g, "''")}'
            AND t.name = '${table.replace(/'/g, "''")}'
  AND i.name IS NOT NULL
ORDER BY 
    i.is_primary_key DESC, 
    i.type;
        `;
        
        const indexResult = await runQuery(indexQuery);
        metadata.indexes = indexResult?.rows || indexResult?.results?.[0]?.rows || [];
      }
      
      // 3. Fetch statistics information
      if (includeStatistics) {
        const statsQuery = `
          SELECT 
            SUM(p.rows) as totalRows,
            SUM(a.total_pages) * 8 as totalSpaceKB,
            SUM(a.used_pages) * 8 as usedSpaceKB
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          JOIN sys.partitions p ON t.object_id = p.object_id
          JOIN sys.allocation_units a ON p.partition_id = a.container_id
          WHERE s.name = '${schema.replace(/'/g, "''")}'
            AND t.name = '${table.replace(/'/g, "''")}'
            AND p.index_id IN (0, 1)
          GROUP BY t.object_id
        `;
        
        const statsResult = await runQuery(statsQuery);
        const statsRow = statsResult?.rows?.[0] || statsResult?.results?.[0]?.rows?.[0];
        if (statsRow) {
          metadata.statistics = {
            totalRows: statsRow.totalRows || 0,
            totalSpaceKB: statsRow.totalSpaceKB || 0,
            usedSpaceKB: statsRow.usedSpaceKB || 0,
          };
        }
      }
      
      console.log(`[get_user_table_schema] Successfully fetched metadata for ${schema}.${table}`);
      console.log(`[get_user_table_schema] Columns: ${metadata.columns.length}, Indexes: ${metadata.indexes.length}`);
      
      return safeJSONStringify({
        type: "success",
        metadata,
        reminder: "⚠️ Use this metadata to provide specific index recommendations. Check if recommended indexes already exist!",
      });
    } catch (e) {
      console.error('[get_user_table_schema] Error:', e);
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

// ============================================================================
// SQL VALIDATION HELPER: Validate query with SQL Server compile check
// ============================================================================
async function validateSqlQuery(query: string): Promise<{ valid: boolean; error?: string; invalidColumns?: string[]; invalidObjects?: string[] }> {
  try {
    // First try: Use sp_describe_first_result_set to validate the query
    const validationQuery = `
      EXEC sys.sp_describe_first_result_set
        @tsql = N'${query.replace(/'/g, "''")}',
        @params = NULL,
        @browse_information_mode = 1;
    `;
    
    await runQuery(validationQuery);
    return { valid: true };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const errorNumber = err?.number;
    console.error('[validateSqlQuery] sp_describe_first_result_set failed:', errorMsg);
    
    // sp_describe_first_result_set often returns the generic error 11501:
    // "The batch could not be analyzed because of compile errors."
    // without the *real* underlying error (invalid column/table, syntax, etc).
    // Fall back to sp_prepare for actionable error details.
    const isGenericDescribeFailure = errorNumber === 11501 || errorMsg.includes('could not be analyzed');
    
    if (isGenericDescribeFailure) {
      try {
        // Fallback: Use sp_prepare which compiles the statement and surfaces detailed errors
        const prepareQuery = `
          DECLARE @h INT;
          BEGIN TRY
            EXEC sys.sp_prepare @h OUTPUT, NULL, N'${query.replace(/'/g, "''")}';
            IF @h IS NOT NULL EXEC sys.sp_unprepare @h;
          END TRY
          BEGIN CATCH
            IF @h IS NOT NULL EXEC sys.sp_unprepare @h;
            THROW;
          END CATCH
        `;
        await runQuery(prepareQuery);
        // If sp_prepare succeeded, the query is valid
        return { valid: true };
      } catch (prepareErr: any) {
        const prepareErrorMsg = prepareErr?.message || String(prepareErr);
        console.error('[validateSqlQuery] sp_prepare also failed:', prepareErrorMsg);
        // Use the sp_prepare error (more detailed) instead of the generic describe error
        return parseValidationError(prepareErrorMsg);
      }
    }
    
    // For non-generic errors, parse the sp_describe_first_result_set error
    return parseValidationError(errorMsg);
  }
}

// Helper function to parse validation errors and extract invalid columns/objects
function parseValidationError(errorMsg: string): { valid: false; error: string; invalidColumns?: string[]; invalidObjects?: string[] } {
  const invalidColumns: string[] = [];
  const invalidObjects: string[] = [];
  
  // Parse SQL Server error messages for invalid column names
  const columnMatch = errorMsg.match(/Invalid column name '([^']+)'/gi);
  if (columnMatch) {
    columnMatch.forEach((m: string) => {
      const col = m.match(/Invalid column name '([^']+)'/i)?.[1];
      if (col) invalidColumns.push(col);
    });
  }
  
  // Parse for invalid object names
  const objectMatch = errorMsg.match(/Invalid object name '([^']+)'/gi);
  if (objectMatch) {
    objectMatch.forEach((m: string) => {
      const obj = m.match(/Invalid object name '([^']+)'/i)?.[1];
      if (obj) invalidObjects.push(obj);
    });
  }
  
  return {
    valid: false,
    error: errorMsg,
    invalidColumns: invalidColumns.length > 0 ? invalidColumns : undefined,
    invalidObjects: invalidObjects.length > 0 ? invalidObjects : undefined,
  };
}

// ============================================================================
// DIAGNOSTIC QUERY TOOL: Safe system query execution for Chat AI
// ============================================================================
export const run_diagnostic_query = tool({
  description: `🔍 DIAGNOSTIC QUERY TOOL - Execute read-only queries to diagnose SQL Server issues and read database objects.
  
  🚨🚨🚨 CRITICAL REQUIREMENT - READ THIS FIRST 🚨🚨🚨
  
  ⛔ BEFORE querying ANY system object (sys.*, INFORMATION_SCHEMA.*, msdb.*), you MUST:
     1. Call get_system_object_schema FIRST to fetch the schema
     2. THEN construct your query using ONLY the columns from that schema
     3. NEVER use SELECT * on system objects - always specify columns explicitly
  
  ✅ CORRECT WORKFLOW:
     Step 1: Call get_system_object_schema(['sys.dm_os_sys_info'])
     Step 2: Use returned columns to build query: SELECT physical_memory_kb, virtual_memory_kb FROM sys.dm_os_sys_info
     Step 3: Call run_diagnostic_query with the specific columns
  
  ❌ WRONG WORKFLOW (DO NOT DO THIS):
     Step 1: Call run_diagnostic_query with SELECT * FROM sys.dm_os_sys_info
     Step 2: Get schema_required error
     Step 3: Call get_system_object_schema
     Step 4: Retry query
  
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  ✅ YOU CAN QUERY ALL OBJECTS:
  - USER objects: stored procedures, functions, views, triggers, tables (dbo.*, any schema)
  - SYSTEM objects: DMVs, catalog views (sys.*, INFORMATION_SCHEMA.*)
  - MSDB objects: backup history, jobs, alerts (msdb.dbo.*, msdb.sys.*)
  
  ⚠️ SAFETY RESTRICTIONS (ENFORCED):
  - ONLY SELECT queries allowed (no INSERT/UPDATE/DELETE/DROP/CREATE/ALTER)
  - SQL Server compile validation before execution (catches invalid columns/objects)
  - Automatically adds TOP 100 if no TOP/FETCH clause exists
  - Executes immediately without user permission (safe diagnostic queries)
  
  ✅ STORED PROCEDURES YOU CAN EXECUTE:
  - sp_Blitz, sp_BlitzCache, sp_BlitzIndex, sp_BlitzFirst, sp_BlitzLock, sp_BlitzWho (Brent Ozar scripts)
  - sp_WhoIsActive (Adam Machanic)
  - sp_who2, sp_who, sp_configure, sp_helpdb, sp_spaceused, sp_lock, sp_monitor
  - DBCC SQLPERF, DBCC TRACESTATUS, DBCC INPUTBUFFER, DBCC OPENTRAN
  
  📊 USE THIS TOOL TO:
  - Detect performance issues (slow queries, blocking, waits)
  - Check backup status, job failures, disk space
  - Analyze index usage, missing indexes, fragmentation
  - Monitor server health (CPU, memory, connections)
  - Investigate deadlocks, errors, long-running queries
  - Run comprehensive diagnostics with sp_Blitz and related procedures
  - Read database object definitions (procedures, functions, views, triggers)
  
  🚨 WHEN USER ASKS:
  - "Run sp_Blitz" → EXEC sp_Blitz
  - "Run sp_BlitzCache" → EXEC sp_BlitzCache
  - "Read/show [object_name]" → SELECT OBJECT_DEFINITION(OBJECT_ID('[schema].[object_name]'))
  - "Can you read this proc/function/view/trigger?" → SELECT OBJECT_DEFINITION(OBJECT_ID('[object_name]'))
  - "Analyze [object_name]" → First get definition with OBJECT_DEFINITION, then analyze it
  - "Which SQL Server instances are you connected to?" → Query sys.dm_exec_connections, @@SERVERNAME
  - "Is there any slowness?" → Query sys.dm_exec_requests, sys.dm_os_wait_stats
  - "Show me backup status" → Query msdb.dbo.backupset
  - "Are there any blocking queries?" → Query sys.dm_exec_requests with blocking_session_id
  - "Check disk space" → Query sys.dm_os_volume_stats
  
  💡 TO READ DATABASE OBJECTS: Use OBJECT_DEFINITION(OBJECT_ID('[schema].[name]')) for any object type:
     - Stored procedures, functions, views, triggers, defaults, rules, etc.
     - Works for all programmable objects in the database
  
  ⚠️ CRITICAL: After getting results, you MUST analyze them and provide actionable recommendations.
  
  🔄 IF VALIDATION FAILS: The error will tell you which columns/objects are invalid. Regenerate the query with correct names.`,
  parameters: z.object({
    query: z.string().describe("The diagnostic SQL query to execute. Can query BOTH system objects (sys.*, INFORMATION_SCHEMA.*) AND user objects (stored procedures, functions, views, tables, triggers). Use OBJECT_DEFINITION(OBJECT_ID('name')) to read object definitions."),
    explanation: z.string().describe("Brief explanation of what this query checks (e.g., 'Checking for blocking sessions', 'Reading stored procedure definition', 'Analyzing backup history')"),
  }),
  execute: async (params) => {
    try {
      // Proactive schema-first enforcement (BEFORE any execution/validation):
      // If the query references system objects and we don't have their schemas yet,
      // automatically fetch them first to avoid invalid column guesses.
      try {
        const sqlText = String(params?.query || '').trim();
        const referenced = extractReferencedSystemObjects(sqlText);
        if (referenced.length > 0) {
          const missing = referenced.filter((o) => !fetchedSystemObjectSchemas.has(normalizeSystemObjectName(o)));
          if (missing.length > 0) {
            console.log('[run_diagnostic_query] Auto-fetching schemas for:', missing);
            // Automatically fetch the missing schemas
            try {
              const schemaResult = await (get_system_object_schema_cached as any).execute({ systemObjects: missing });
              console.log('[run_diagnostic_query] Auto-fetched schemas successfully');
              // Mark these schemas as fetched
              for (const o of missing) {
                const key = normalizeSystemObjectName(o);
                if (key) fetchedSystemObjectSchemas.add(key);
              }
            } catch (schemaError) {
              console.error('[run_diagnostic_query] Failed to auto-fetch schemas:', schemaError);
              // If auto-fetch fails, return the schema_required error as before
              return safeJSONStringify({
                type: 'schema_required',
                message: 'Schema required before running diagnostic query. Fetch system object schemas first to avoid invalid column names.',
                recommendedSchemas: missing,
                nextStep: 'Call get_system_object_schema with recommendedSchemas, then regenerate SQL using only those columns.',
              });
            }
          }
        }
      } catch {}

      // Mark that we're executing a diagnostic query (for tracking only, no blocking)
      diagnosticQueryInFlight = true;
      diagnosticQueryExecutedThisTurn = true;

      const isShowPlanXml = (v: any) => {
        if (typeof v !== 'string') return false;
        const s = v.trim();
        if (!s) return false;
        if (s.startsWith('<ShowPlanXML')) return true;
        if (s.startsWith('<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"')) return true;
        return false;
      };

      const compactRunQueryResult = (value: any) => {
        try {
          const MAX_JSON_CHARS_DEFAULT = 60_000;
          const MAX_ROWS_DEFAULT = 200;
          const MAX_CELL_CHARS_DEFAULT = 400;

          const detectPlanColumns = (rs: any) => {
            const planIndexes: number[] = [];
            const planKeys: string[] = [];

            const fields = Array.isArray(rs?.fields) ? rs.fields : [];
            for (let i = 0; i < fields.length; i++) {
              const name = String(fields[i]?.name || '').trim();
              if (name && /(^|\b)(query[_\s-]?plan)(\b|$)/i.test(name)) {
                planIndexes.push(i);
                planKeys.push(name);
              }
            }

            if (planIndexes.length === 0 && Array.isArray(rs?.rows)) {
              for (const row of rs.rows) {
                if (Array.isArray(row)) {
                  for (let i = 0; i < row.length; i++) {
                    if (isShowPlanXml(row[i])) {
                      planIndexes.push(i);
                    }
                  }
                } else if (row && typeof row === 'object') {
                  for (const k of Object.keys(row)) {
                    if (/^query[_\s-]?plan$/i.test(String(k))) {
                      planKeys.push(k);
                    } else if (isShowPlanXml((row as any)[k])) {
                      planKeys.push(k);
                    }
                  }
                }
                if (planIndexes.length || planKeys.length) break;
              }
            }

            return {
              hasPlan: planIndexes.length > 0 || planKeys.length > 0,
              planIndexes: Array.from(new Set(planIndexes)),
              planKeys: Array.from(new Set(planKeys)),
            };
          };

          const scrubRow = (row: any, planInfo: { planIndexes: number[]; planKeys: string[] }) => {
            const planIndexes = planInfo.planIndexes;
            const planKeys = planInfo.planKeys;

            const summarizeCell = (v: any) => {
              if (!isShowPlanXml(v)) return v;
              const len = typeof v === 'string' ? v.length : 0;
              return `<<ShowPlanXML omitted: ${len} chars>>`;
            };

            if (Array.isArray(row)) {
              const out = row.slice();
              for (const idx of planIndexes) {
                if (idx >= 0 && idx < out.length) out[idx] = summarizeCell(out[idx]);
              }
              return out;
            }
            if (row && typeof row === 'object') {
              const out: any = { ...row };
              for (const k of planKeys) {
                if (k in out) out[k] = summarizeCell(out[k]);
              }
              for (const k of Object.keys(out)) {
                if (isShowPlanXml(out[k])) out[k] = summarizeCell(out[k]);
              }
              return out;
            }
            return summarizeCell(row);
          };

          const truncateCell = (v: any, maxCellChars: number) => {
            if (typeof v !== 'string') return v;
            if (v.length <= maxCellChars) return v;
            return v.slice(0, maxCellChars) + '…';
          };

          const cloneRow = (row: any, maxCellChars: number, planInfo: { planIndexes: number[]; planKeys: string[] }) => {
            const scrubbed = scrubRow(row, planInfo);
            if (Array.isArray(scrubbed)) return scrubbed.map((v) => truncateCell(v, maxCellChars));
            if (scrubbed && typeof scrubbed === 'object') {
              const out: any = {};
              for (const k of Object.keys(scrubbed)) out[k] = truncateCell((scrubbed as any)[k], maxCellChars);
              return out;
            }
            return truncateCell(scrubbed, maxCellChars);
          };

          const compact = (obj: any, maxRows: number, maxCellChars: number) => {
            if (!obj || typeof obj !== 'object') return obj;
            if (!Array.isArray(obj.results)) return obj;
            const out: any = { ...obj };

            let anyPlan = false;

            out.results = obj.results.map((rs: any) => {
              if (!rs || typeof rs !== 'object') return rs;

              const planInfo = detectPlanColumns(rs);
              if (planInfo.hasPlan) anyPlan = true;

              const rsOut: any = { ...rs };
              if (Array.isArray(rs.rows)) {
                const originalRowCount = rs.rows.length;
                if (originalRowCount > maxRows) {
                  rsOut.rows = rs.rows.slice(0, maxRows).map((r: any) => cloneRow(r, maxCellChars, planInfo));
                  rsOut.truncated = true;
                  rsOut.originalRowCount = originalRowCount;
                } else {
                  rsOut.rows = rs.rows.map((r: any) => cloneRow(r, maxCellChars, planInfo));
                }
              }

              if (planInfo.hasPlan) {
                let omittedCount = 0;
                let omittedChars = 0;
                try {
                  const rows = Array.isArray(rs?.rows) ? rs.rows : [];
                  for (const row of rows) {
                    if (Array.isArray(row)) {
                      for (const idx of planInfo.planIndexes) {
                        const v = row?.[idx];
                        if (isShowPlanXml(v)) {
                          omittedCount++;
                          omittedChars += String(v).length;
                        }
                      }
                    } else if (row && typeof row === 'object') {
                      for (const k of Object.keys(row)) {
                        const v = (row as any)[k];
                        if (isShowPlanXml(v)) {
                          omittedCount++;
                          omittedChars += String(v).length;
                        }
                      }
                    }
                  }
                } catch (_) {}

                rsOut.queryPlanOmitted = {
                  omittedCount,
                  omittedChars,
                  detectedColumns: {
                    byName: planInfo.planKeys,
                    byIndex: planInfo.planIndexes,
                  },
                };
              }

              return rsOut;
            });

            out._compactMeta = {
              anyPlan,
            };

            return out;
          };

          let maxRows = MAX_ROWS_DEFAULT;
          let maxCellChars = MAX_CELL_CHARS_DEFAULT;
          let out = compact(value, maxRows, maxCellChars);

          const anyPlan = !!(out as any)?._compactMeta?.anyPlan;
          const maxJsonChars = anyPlan ? 20_000 : MAX_JSON_CHARS_DEFAULT;
          if (anyPlan) {
            maxRows = 25;
            maxCellChars = 250;
            out = compact(value, maxRows, maxCellChars);
          }

          let len = 0;
          try {
            len = JSON.stringify(out).length;
          } catch {
            len = maxJsonChars + 1;
          }

          if (len > maxJsonChars) {
            const fallbackRows = anyPlan ? 10 : 50;
            out = compact(value, fallbackRows, anyPlan ? 200 : maxCellChars);
            (out as any).truncated = true;
          }

          try {
            if (out && typeof out === 'object' && '_compactMeta' in out) {
              delete (out as any)._compactMeta;
            }
          } catch (_) {}

          return out;
        } catch (_) {
          return value;
        }
      };
      
      console.log('[run_diagnostic_query] Executing diagnostic query:', params.explanation);
      console.log('[run_diagnostic_query] Query:', params.query.substring(0, 200));
      
      // Safety validation
      const normalizeDiagnosticSql = (raw: string) => {
        try {
          let s = String(raw || '').replace(/^\uFEFF/, '').trim();
          // Some prompts include human labels like "- Query 1:" before the SQL.
          // Strip leading markdown bullets/headings and "Query N:" prefixes.
          // We only strip BEFORE the first SQL keyword.
          const lines = s.split(/\r?\n/);
          const out: string[] = [];
          let started = false;
          for (let line of lines) {
            const original = line;
            line = String(line || '').trim();
            if (!started) {
              // Drop empty lines and common label lines.
              if (!line) continue;
              line = line.replace(/^[-*\s]+/, '');
              line = line.replace(/^query\s*\d+\s*:\s*/i, '');
              // If after stripping we still don't start with a SQL keyword, keep skipping.
              if (!/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|DBCC|EXEC(?:UTE)?)\b/i.test(line)) {
                continue;
              }
              started = true;
              out.push(line);
              continue;
            }
            out.push(original);
          }
          return (out.length > 0 ? out.join('\n') : s).trim();
        } catch {
          return String(raw || '').trim();
        }
      };

      const query = normalizeDiagnosticSql(params.query);
      const queryUpper = query.toUpperCase();

      // Optional: allow broad system diagnostic procedures (sp_*) when explicitly enabled.
      // We still block known high-risk families (xp_*, sp_OA*).
      let allowBroadSystemDiagnosticProcedures = false;
      try {
        const { useConfigurationStore } = await import('@/stores/configuration');
        allowBroadSystemDiagnosticProcedures = !!useConfigurationStore()?.allowBroadSystemDiagnosticProcedures;
      } catch (_) {
        allowBroadSystemDiagnosticProcedures = false;
      }
      console.log('[run_diagnostic_query] allowBroadSystemDiagnosticProcedures:', allowBroadSystemDiagnosticProcedures);
      
      // List of safe diagnostic stored procedures that are allowed
      const safeDiagnosticProcedures = [
        'SP_WHO2',
        'SP_WHO',
        'SP_SPACEUSED',
        'SP_LOCK',
        'SP_MONITOR',
        'SP_CONFIGURE',
        'SP_READERRORLOG',
        'SP_HELPDB',
        'SP_HELPJOB',
        'SP_HELPJOBHISTORY',
        'SP_HELPJOBSTEP',
        'SP_HELPJOBCATEGORY',
        'SP_HELPALERT',
        'SP_HELPOPERATOR',
        'SP_HELPSCHEDULE',
        'SP_HELPDATABASEMAILPROFILE',
        'SP_HELPLOGSHIPPINGMONITOR',
        'SP_HELPLOGSHIPPINGPRIMARYDATABASE',
        'SP_HELPLOGSHIPPINGSECONDARYDATABASE',
        'SP_HELPLOGSHIPPINGSECONDARYPRIMARY',
        'SP_BLITZCACHE',
        'SP_BLITZ',
        'SP_BLITZINDEX',
        'SP_BLITZFIRST',
        'SP_BLITZLOCK',
        'SP_BLITZWHO',
        'SP_ASKBRENT',
        'SP_PURGEQUERYSTORE',
        'SP_WHOISACTIVE',
        'DBCC SQLPERF',
        'DBCC TRACESTATUS',
        'DBCC INPUTBUFFER',
        'DBCC OPENTRAN',
        'XP_READERRORLOG',
        'XP_INSTANCE_REGREAD',
      ];
      
      // Check if this is an EXEC of a safe diagnostic procedure
      const isExecProcedure = /^\s*EXEC(?:UTE)?\s+/i.test(query);
      let isSafeProcedure = false;
      let procName: string | null = null;
      
      if (isExecProcedure) {
        // Extract ALL procedure names from EXEC statements. We support qualified names like:
        // - EXEC xp_readerrorlog ...
        // - EXEC master..xp_readerrorlog ...
        // - EXEC msdb.dbo.sp_helpjob ...
        const execMatches = Array.from(query.matchAll(/\bEXEC(?:UTE)?\s+((?:\w+\.){0,2})?(\w+)/gi));
        const procNames = execMatches
          .map((m) => String(m?.[2] || '').trim().toUpperCase())
          .filter(Boolean);

        // Always block xp_cmdshell: it can execute OS commands.
        // If a multi-statement batch includes it, block the whole batch.
        if (procNames.some((p) => p === 'XP_CMDSHELL')) {
          return safeJSONStringify({
            type: 'error',
            message:
              '❌ BLOCKED: xp_cmdshell is not allowed in diagnostic mode because it can execute OS commands.\n\n' +
              'Remove the xp_cmdshell statement and run the remaining safe diagnostics separately (e.g., xp_readerrorlog, xp_instance_regread).',
          });
        }

        // If we couldn't parse a proc name, treat as unsafe.
        if (procNames.length > 0) {
          procName = procNames[0];
          // All EXECs in the batch must be safe for the batch to be allowed.
          isSafeProcedure = procNames.every((p) => {
            if (safeDiagnosticProcedures.includes(p)) return true;

            if (allowBroadSystemDiagnosticProcedures) {
              // Allow broad sp_* execution, but keep a denylist for dangerous categories.
              // Additionally, allow xp_readerrorlog explicitly since it is commonly used to read logs.
              const isSp = p.startsWith('SP_');
              const isXp = p.startsWith('XP_');
              const isOleAutomation = p.startsWith('SP_OA');
              const isXpReadErrorLog = p === 'XP_READERRORLOG';
              const isDangerous = (isXp && !isXpReadErrorLog) || isOleAutomation;
              if (isXpReadErrorLog) return true;
              if (isSp && !isDangerous) return true;
            }

            return false;
          });
        }
      }
      
      // 1. Allow SELECT, WITH, INSERT, CREATE, UPDATE, DELETE, ALTER, DROP, TRUNCATE, DBCC, and safe EXEC procedures
      // Block will happen later for UPDATE/DELETE/ALTER on user tables specifically
      const allowedStarts = ['SELECT', 'WITH', 'INSERT', 'CREATE', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'TRUNCATE', 'DBCC'];
      const startsWithAllowed = allowedStarts.some(keyword => queryUpper.startsWith(keyword));
      
      if (!startsWithAllowed && !isSafeProcedure) {
        // If this is an EXEC batch, show which procedure caused the block.
        try {
          if (isExecProcedure) {
            return safeJSONStringify({
              type: 'error',
              message:
                `❌ BLOCKED: The diagnostic batch includes an EXEC of an unsafe procedure${procName ? ` (${procName})` : ''}. ` +
                'Only SELECT/WITH and a limited allowlist of safe diagnostic procedures are permitted.\n\n' +
                'Tip: run safe procedures (xp_readerrorlog, xp_instance_regread, sp_WhoIsActive, sp_Blitz*) in separate calls. xp_cmdshell remains blocked.',
            });
          }
        } catch {}
        return safeJSONStringify({
          type: "error",
          message: "❌ BLOCKED: Only SELECT, INSERT, CREATE, UPDATE, DELETE, ALTER queries and safe diagnostic stored procedures are allowed.",
        });
      }
      
      // 2. Block UPDATE/DELETE/ALTER on user tables only (allow on system objects)
      // Allow: SELECT/INSERT/CREATE on anything, UPDATE/DELETE/ALTER/DROP/TRUNCATE on system objects only
      // Block: UPDATE/DELETE/ALTER/DROP/TRUNCATE on user tables
      if (!isSafeProcedure) {
        const dangerousKeywords = [
          { keyword: 'INSERT', pattern: /\bINSERT\s+INTO\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'UPDATE', pattern: /\bUPDATE\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'DELETE', pattern: /\bDELETE\s+FROM\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'DROP', pattern: /\bDROP\s+(?:TABLE|INDEX|VIEW|PROCEDURE|FUNCTION)\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'CREATE', pattern: /\bCREATE\s+(?:TABLE|INDEX|VIEW|PROCEDURE|FUNCTION)\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'ALTER', pattern: /\bALTER\s+(?:TABLE|INDEX|VIEW|PROCEDURE|FUNCTION)\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
          { keyword: 'TRUNCATE', pattern: /\bTRUNCATE\s+TABLE\s+(?!msdb\.|master\.|sys\.|INFORMATION_SCHEMA\.)(?:\w+\.)?dbo\.\w+/i },
        ];
        
        for (const { keyword, pattern } of dangerousKeywords) {
          if (pattern.test(query)) {
            return safeJSONStringify({
              type: "error",
              message: `❌ BLOCKED: ${keyword} operation on user tables is not allowed. You can only SELECT from user tables, or perform ${keyword} on system objects.`,
            });
          }
        }
      }
      
      // 3. Must query system objects only OR use global variables/functions
      const systemObjectPatterns = [
        /\bsys\.\w+/gi,
        /\bmsdb\.dbo\.\w+/gi,
        /\bmsdb\.sys\.\w+/gi,
        /\bINFORMATION_SCHEMA\.\w+/gi,
        /\bmaster\.dbo\.\w+/gi,
        /\bmaster\.sys\.\w+/gi,
      ];
      
      // Global variables and functions that are safe (server-level info only)
      const globalVariablesAndFunctions = [
        /@@SERVERNAME/gi,
        /@@VERSION/gi,
        /@@LANGUAGE/gi,
        /@@SPID/gi,
        /SERVERPROPERTY\s*\(/gi,
        /DATABASEPROPERTYEX\s*\(/gi,
        /DB_NAME\s*\(/gi,
        /DB_ID\s*\(/gi,
        /GETDATE\s*\(/gi,
        /CURRENT_TIMESTAMP/gi,
      ];
      
      const hasSystemObjects = systemObjectPatterns.some(pattern => pattern.test(query));
      const hasGlobalVariables = globalVariablesAndFunctions.some(pattern => pattern.test(query));
      
      // Check if query has no FROM clause (safe - just returns server-level info)
      const hasFromClause = /\bFROM\b/gi.test(query);
      const isGlobalVariableQuery = !hasFromClause && hasGlobalVariables;
      
      // User tables are now allowed for SELECT, INSERT, CREATE operations
      // The destructive operations (UPDATE/DELETE/ALTER) on user tables are already blocked above
      // So we can allow queries that reference user tables as long as they're not destructive
      
      // 4. Add TOP 100 if no TOP/FETCH clause exists (safety limit) - but skip for EXEC procedures
      let safeQuery = query;
      if (!isSafeProcedure && !queryUpper.includes('TOP ') && !queryUpper.includes('FETCH ') && !queryUpper.startsWith('DBCC')) {
        safeQuery = query.replace(/^(SELECT\s+)/i, '$1TOP 100 ');
        console.log('[run_diagnostic_query] Added TOP 100 safety limit');
      }

      // If the query is a stored procedure exec, optionally adjust database context.
      // NOTE: We do this *before* execution so that procedures that depend on current DB context
      // don't accidentally run in master.
      const isExecStatement = /^\s*EXEC(?:UTE)?\s+/i.test(safeQuery);
      if (isExecStatement) {
        try {
          const procMatch = safeQuery.match(/^\s*EXEC(?:UTE)?\s+(?:\[?dbo\]?\.)?\[?(\w+)\]?/i);
          const procName = (procMatch?.[1] ? String(procMatch[1]) : '').toUpperCase();

          // 1) Always run SQL Agent job-related helpers in msdb.
          // These procs live in msdb and often require msdb context for consistent behavior.
          const isMsdbJobProc =
            procName === 'SP_HELPJOB' ||
            procName === 'SP_HELPJOBHISTORY' ||
            procName === 'SP_HELPJOBSTEP' ||
            procName === 'SP_HELPJOBCATEGORY' ||
            procName === 'SP_HELPALERT' ||
            procName === 'SP_HELPOPERATOR' ||
            procName === 'SP_HELPSCHEDULE' ||
            procName === 'SP_HELPDATABASEMAILPROFILE' ||
            procName === 'SP_HELPLOGSHIPPINGMONITOR' ||
            procName === 'SP_HELPLOGSHIPPINGPRIMARYDATABASE' ||
            procName === 'SP_HELPLOGSHIPPINGSECONDARYDATABASE' ||
            procName === 'SP_HELPLOGSHIPPINGSECONDARYPRIMARY';

          if (isMsdbJobProc && !/^\s*USE\s+/i.test(safeQuery)) {
            safeQuery = `USE [msdb]; ${safeQuery}`;
            console.log('[run_diagnostic_query] Prefixed USE msdb for job-related procedure:', procName);
          }

          // 2) Heuristic: If the first string argument looks like a DB name and exists in sys.databases,
          // run the procedure in that database context.
          // IMPORTANT: Do NOT apply this to object-helper procs (sp_help/sp_helpindex/sp_helpconstraint)
          // because their first argument is an object name, not a database name.
          const isObjectHelperProc =
            procName === 'SP_HELP' ||
            procName === 'SP_HELPINDEX' ||
            procName === 'SP_HELPCONSTRAINT';

          if (!isObjectHelperProc && !/^\s*USE\s+/i.test(safeQuery)) {
            const argMatch = safeQuery.match(/\s+(?:N\s*)?'([^']+)'/i);
            const firstArg = (argMatch?.[1] ? String(argMatch[1]) : '').trim();

            // Ignore object-like args or weird args.
            const looksLikeObjectName =
              firstArg.includes('.') ||
              firstArg.includes('[') ||
              firstArg.includes(']') ||
              /\s/.test(firstArg);

            if (firstArg && !looksLikeObjectName) {
              try {
                const escaped = firstArg.replace(/'/g, "''");
                const dbProbe: any = await runQuery(`SELECT name FROM sys.databases WHERE name = '${escaped}'`);
                const hasDb = Array.isArray(dbProbe?.results?.[0]?.rows) && dbProbe.results[0].rows.length > 0;
                if (hasDb) {
                  const dbNameEscaped = firstArg.replace(/\]/g, ']]');
                  safeQuery = `USE [${dbNameEscaped}]; ${safeQuery}`;
                  console.log('[run_diagnostic_query] Prefixed USE <db> based on first EXEC arg:', firstArg);
                }
              } catch (_) {
                // ignore probe failures and execute original query
              }
            }
          }
        } catch (_) {
          // ignore and execute original query
        }
      }

      // Special-case: sp_spaceused
      // If the query is `EXEC sp_spaceused N'<name>'` and <name> looks like a database name (not an object like dbo.Table),
      // run it in the correct DB context. Otherwise SQL Server tries to resolve the string as an object name in the current DB (often master).
      try {
        const m = safeQuery.match(/^\s*EXEC(?:UTE)?\s+(?:dbo\.)?sp_spaceused\s+(?:N\s*)?'([^']+)'\s*;?\s*$/i);
        if (m && m[1]) {
          const arg = String(m[1] || '').trim();
          const looksLikeObjectName = arg.includes('.') || arg.includes('[') || arg.includes(']');
          if (!looksLikeObjectName) {
            const dbNameEscaped = arg.replace(/\]/g, ']]');
            safeQuery = `USE [${dbNameEscaped}]; EXEC sp_spaceused;`;
            console.log('[run_diagnostic_query] Rewrote sp_spaceused to run in database context:', arg);
          }
        }
      } catch (_) {}
      
      // 5. SKIP validation - go straight to test execution for faster feedback
      // Validation only catches compile errors, but test execution catches everything
      // This gives the AI immediate, real SQL Server error messages
      console.log('[run_diagnostic_query] ⏭️ Skipping validation, going straight to test execution for faster feedback');
      
      const skipValidation = false; // Enforce compile validation to prevent invalid DMV column/alias guesses
      
      if (!skipValidation && !isSafeProcedure) {
        console.log('[run_diagnostic_query] Validating query with SQL Server compile check...');
        const validation = await validateSqlQuery(safeQuery);
      
        if (!validation.valid) {
          console.error('[run_diagnostic_query] Validation failed:', validation.error);

          const extractReferencedSystemObjects = (sqlText: string): string[] => {
            try {
              const q = String(sqlText || '');
              const matches = q.match(/\b(?:sys|msdb\.dbo|msdb\.sys|INFORMATION_SCHEMA|master\.dbo|master\.sys)\.[A-Za-z0-9_]+\b/gi) || [];
              const out: string[] = [];
              const seen = new Set<string>();
              for (const m of matches) {
                const n = String(m || '').trim();
                if (!n) continue;
                const key = n.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(n);
              }
              return out;
            } catch (_) {
              return [];
            }
          };

          const referencedObjects = extractReferencedSystemObjects(safeQuery);
          
          // Check if this is a hex value syntax error (spaces in binary literals)
          const hexErrorPattern = /Incorrect syntax near '([0-9A-F\s]+)'/i;
          const hexMatch = validation.error?.match(hexErrorPattern);
          
          if (hexMatch && hexMatch[1] && hexMatch[1].includes(' ')) {
            // This is a hex value with spaces - try to auto-fix
            console.log('[run_diagnostic_query] Detected hex value with spaces, attempting auto-fix...');
            
            // Remove all spaces from hex values in the query
            const fixedQuery = safeQuery.replace(/0x([0-9A-F\s]+)/gi, (match, hexPart) => {
              return '0x' + hexPart.replace(/\s+/g, '');
            });
            
            console.log('[run_diagnostic_query] Auto-fixed query:', fixedQuery);
            
            // Try validation again with fixed query
            const revalidation = await validateSqlQuery(fixedQuery);
            
            if (revalidation.valid) {
              console.log('[run_diagnostic_query] ✅ Auto-fix successful, executing fixed query');
              safeQuery = fixedQuery; // Use the fixed query
            } else {
              console.error('[run_diagnostic_query] Auto-fix failed, returning error');
              return safeJSONStringify({
                type: "schema_required",
                message: `❌ QUERY VALIDATION FAILED: ${validation.error}\n\n🔧 Attempted auto-fix for hex values but validation still failed: ${revalidation.error}`,
                nextStep: "Call get_system_object_schema for the referenced objects (if any), then regenerate the query using ONLY valid columns.",
                recommendedSchemas: referencedObjects,
              });
            }
          } else {
            // Not a hex error, return standard error message with specific guidance
            let errorMessage = `❌ QUERY VALIDATION FAILED: ${validation.error}`;
            
            // Detect specific error patterns and provide targeted guidance
            if (validation.error?.includes('blocking_session_id')) {
              errorMessage += '\n\n🔴 COLUMN ERROR: blocking_session_id does not exist in sys.dm_exec_sessions';
              errorMessage += '\n\n✅ SOLUTION: Use sys.dm_exec_requests instead:';
              errorMessage += '\n   SELECT session_id, blocking_session_id, wait_type, wait_time, command, status';
              errorMessage += '\n   FROM sys.dm_exec_requests';
              errorMessage += '\n   WHERE blocking_session_id <> 0';
            } else if (validation.error?.includes('could not be bound') && validation.error?.includes('sql_handle')) {
              // Attempt automatic fix: Replace INNER JOIN with CROSS APPLY for table-valued functions
              console.log('[run_diagnostic_query] Attempting auto-fix: INNER JOIN → CROSS APPLY');
              
              // Pattern: INNER JOIN sys.dm_exec_sql_text(...) AS alias → CROSS APPLY sys.dm_exec_sql_text(...) AS alias
              let fixedQuery = safeQuery.replace(/INNER\s+JOIN\s+(sys\.dm_exec_sql_text\([^)]+\))\s+AS\s+(\w+)/gi, 'CROSS APPLY $1 AS $2');
              
              // Also handle: FROM sys.dm_exec_sql_text(...) AS t INNER JOIN table AS r
              fixedQuery = fixedQuery.replace(/FROM\s+(sys\.dm_exec_sql_text\([^)]+\))\s+AS\s+(\w+)\s+INNER\s+JOIN\s+([^\s]+)\s+AS\s+(\w+)/gi, 'FROM $3 AS $4 CROSS APPLY $1 AS $2');
              
              if (fixedQuery !== safeQuery) {
                console.log('[run_diagnostic_query] Auto-fix applied, re-validating...');
                console.log('[run_diagnostic_query] Original:', safeQuery);
                console.log('[run_diagnostic_query] Fixed:', fixedQuery);
                
                const revalidation = await validateSqlQuery(fixedQuery);
                if (revalidation.valid) {
                  console.log('[run_diagnostic_query] ✅ Auto-fix successful, executing fixed query');
                  safeQuery = fixedQuery;
                } else {
                  console.error('[run_diagnostic_query] Auto-fix failed, returning error');
                  return safeJSONStringify({
                    type: "validation_error",
                    message: `❌ QUERY VALIDATION FAILED: ${validation.error}\n\n🔧 Attempted auto-fix (INNER JOIN → CROSS APPLY) but validation still failed: ${revalidation.error}\n\n⚠️ You MUST use CROSS APPLY with table-valued functions, not INNER JOIN.`,
                  });
                }
              } else {
                errorMessage += '\n\n🔴 SYNTAX ERROR: Cannot use table-valued function in INNER JOIN';
                errorMessage += '\n\n✅ SOLUTION: Use CROSS APPLY instead:';
                errorMessage += '\n   SELECT r.session_id, t.text';
                errorMessage += '\n   FROM sys.dm_exec_requests r';
                errorMessage += '\n   CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t';
                errorMessage += '\n   WHERE r.session_id IN (...)';
                errorMessage += '\n\n⚠️ NEVER use INNER JOIN with sys.dm_exec_sql_text() - it is a function, not a table!';
              }
            } else if (validation.invalidColumns && validation.invalidColumns.length > 0) {
              errorMessage += `\n\n🔴 Invalid columns: ${validation.invalidColumns.join(', ')}`;
              
              // Special case: sql_handle error - provide explicit CROSS APPLY example
              if (validation.invalidColumns.some(col => col.toLowerCase().includes('sql_handle'))) {
                errorMessage += '\n\n🔴 CRITICAL ERROR: sql_handle is NOT a standalone column!';
                errorMessage += '\n\n✅ CORRECT SYNTAX - Use CROSS APPLY:';
                errorMessage += '\n   SELECT r.session_id, r.blocking_session_id, t.text';
                errorMessage += '\n   FROM sys.dm_exec_requests r';
                errorMessage += '\n   CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t';
                errorMessage += '\n   WHERE r.session_id = 91';
                errorMessage += '\n\n⛔ NEVER use: SELECT text FROM sys.dm_exec_sql_text(sql_handle)';
                errorMessage += '\n⛔ NEVER use: SELECT text FROM sys.dm_exec_sql_text(0x...)';
                errorMessage += '\n\n💡 sql_handle is a COLUMN in sys.dm_exec_requests, not a parameter!';
              } else {
                errorMessage += '\n\n💡 These columns do not exist in the queried objects. Please regenerate the query with correct column names.';
              }
            } else if (validation.invalidObjects && validation.invalidObjects.length > 0) {
              errorMessage += `\n\n🔴 Invalid objects: ${validation.invalidObjects.join(', ')}`;
              errorMessage += '\n\n💡 These objects do not exist. Please check the object names and regenerate the query.';
            }
            
            if (referencedObjects.length > 0) {
              errorMessage += `\n\n✅ NEXT STEP (SCHEMA-FIRST): Call get_system_object_schema for these objects BEFORE retrying:`;
              errorMessage += `\n${referencedObjects.map(o => `   - ${o}`).join('\n')}`;
              errorMessage += `\n\nThen regenerate the SQL using ONLY the columns returned by the schema tool.`;
            }

            errorMessage += '\n\n⚠️ You MUST regenerate the query with COMPLETELY DIFFERENT syntax. Do NOT retry the same approach!';
            
            return safeJSONStringify({
              type: "schema_required",
              message: errorMessage,
              invalidColumns: validation.invalidColumns,
              invalidObjects: validation.invalidObjects,
              recommendedSchemas: referencedObjects,
              nextStep: referencedObjects.length > 0
                ? 'Call get_system_object_schema with recommendedSchemas, then regenerate SQL using only those columns.'
                : 'Call get_system_object_schema for the system objects you plan to use, then regenerate SQL using only those columns.',
            });
          }
        }
        
        console.log('[run_diagnostic_query] ✅ Validation passed');
      } else {
        console.log('[run_diagnostic_query] ⏭️ Skipping validation for safe diagnostic procedure');
      }
      
      // 6. Test execute the validated query (catch runtime errors)
      console.log('[run_diagnostic_query] Test executing validated query...');
      let results;
      try {
        results = await runQuery(safeQuery);
        console.log('[run_diagnostic_query] ✅ Test execution successful');
      } catch (testError) {
        // Test execution failed - return error to AI for correction
        const testErrorMessage = testError instanceof Error ? testError.message : String(testError);
        console.error('[run_diagnostic_query] ❌ Test execution failed:', testErrorMessage);
        
        // Clear the in-flight flag on test execution error
        diagnosticQueryInFlight = false;
        
        // Build detailed error message with the failed query
        let errorGuidance = `❌ QUERY TEST EXECUTION FAILED\n\n`;
        errorGuidance += `📋 Your Query:\n${safeQuery}\n\n`;
        errorGuidance += `🔴 Runtime Error: ${testErrorMessage}\n\n`;
        
        // Provide specific guidance based on error type
        if (testErrorMessage.includes('handle that was passed') && testErrorMessage.includes('was invalid')) {
          errorGuidance += '🔴 CRITICAL ERROR: Invalid handle - session ended or query completed.\n\n';
          errorGuidance += '✅ THE ONLY CORRECT WAY TO GET SQL TEXT:\n';
          errorGuidance += '   SELECT r.session_id, t.text\n';
          errorGuidance += '   FROM sys.dm_exec_requests r\n';
          errorGuidance += '   CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
          errorGuidance += '   WHERE r.session_id = 91\n\n';
          errorGuidance += '⛔ FORBIDDEN PATTERNS (WILL ALWAYS FAIL):\n';
          errorGuidance += '   ❌ SELECT text FROM sys.dm_exec_sql_text(sql_handle)\n';
          errorGuidance += '   ❌ SELECT text FROM sys.dm_exec_sql_text(0x...)\n';
          errorGuidance += '   ❌ INNER JOIN sys.dm_exec_sql_text(...)\n';
          errorGuidance += '   ❌ WHERE sql_handle IN (...)\n\n';
          errorGuidance += '💡 sql_handle is a COLUMN in sys.dm_exec_requests, not a standalone parameter!\n';
        } else if (testErrorMessage.includes('Invalid column name') && testErrorMessage.includes('sql_handle')) {
          errorGuidance += '🔴 CRITICAL ERROR: sql_handle is NOT a standalone column!\n\n';
          errorGuidance += '✅ THE ONLY CORRECT WAY TO GET SQL TEXT:\n';
          errorGuidance += '   SELECT r.session_id, t.text\n';
          errorGuidance += '   FROM sys.dm_exec_requests r\n';
          errorGuidance += '   CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
          errorGuidance += '   WHERE r.session_id = 91\n\n';
          errorGuidance += '⛔ FORBIDDEN PATTERNS (WILL ALWAYS FAIL):\n';
          errorGuidance += '   ❌ SELECT text FROM sys.dm_exec_sql_text(sql_handle)\n';
          errorGuidance += '   ❌ SELECT text FROM sys.dm_exec_sql_text(0x...)\n';
          errorGuidance += '   ❌ INNER JOIN sys.dm_exec_sql_text(...)\n';
          errorGuidance += '   ❌ WHERE sql_handle IN (...)\n\n';
          errorGuidance += '💡 sql_handle ONLY exists inside sys.dm_exec_requests - you MUST join to it with CROSS APPLY!\n';
        } else if (testErrorMessage.includes('Invalid column name')) {
          // Extract the invalid column name from the error message
          const columnMatch = testErrorMessage.match(/Invalid column name '([^']+)'/);
          const invalidColumn = columnMatch ? columnMatch[1] : '';
          
          errorGuidance += '🔴 CRITICAL ERROR: Column does not exist in the schema.\n\n';
          
          // Provide specific guidance for common column name errors
          if (invalidColumn === 'objectid') {
            errorGuidance += '✅ CORRECT COLUMN NAME: object_id (with underscore)\n';
            errorGuidance += '   sys.dm_exec_cached_plans has: object_id, plan_handle, usecounts, size_in_bytes, etc.\n';
            errorGuidance += '   ❌ WRONG: objectid\n';
            errorGuidance += '   ✅ CORRECT: object_id\n\n';
          } else if (invalidColumn === 'plan_handle' || invalidColumn === 'sql_handle') {
            errorGuidance += `✅ ${invalidColumn} is a COLUMN, not a standalone value in WHERE clause!\n`;
            errorGuidance += `   You MUST use CROSS APPLY to access ${invalidColumn}:\n`;
            errorGuidance += `   FROM sys.dm_exec_requests r\n`;
            errorGuidance += `   CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n\n`;
            errorGuidance += `   ❌ WRONG: WHERE ${invalidColumn} IN (...)\n`;
            errorGuidance += `   ✅ CORRECT: CROSS APPLY sys.dm_exec_sql_text(r.sql_handle)\n\n`;
          } else if (invalidColumn === 'object_id') {
            errorGuidance += '✅ CHECK WHICH DMV YOU ARE QUERYING:\n';
            errorGuidance += '   sys.dm_exec_cached_plans: Has object_id column\n';
            errorGuidance += '   sys.dm_exec_query_plan(): Table-valued function - NO object_id column\n';
            errorGuidance += '   sys.dm_exec_procedure_stats: Has object_id column\n\n';
            errorGuidance += '   💡 If querying a function result, you cannot use object_id in WHERE\n';
            errorGuidance += '   💡 Filter BEFORE calling the function, not after\n\n';
          } else {
            errorGuidance += '💡 SOLUTION:\n';
            errorGuidance += '   1. Call get_system_object_schema to fetch ACTUAL column names\n';
            errorGuidance += '   2. Use ONLY columns that exist in the schema\n';
            errorGuidance += '   3. Pay attention to underscores: object_id NOT objectid\n\n';
          }
        } else {
          errorGuidance += '💡 SOLUTION: Fix the query based on the error above and retry.\n';
        }
        
        errorGuidance += '\n⚠️ REGENERATE the query with corrections and call run_diagnostic_query again.';
        
        return safeJSONStringify({
          type: "test_execution_error",
          message: errorGuidance,
          query: safeQuery,
          failedQuery: safeQuery,
          error: testErrorMessage,
          reminder: "Fix the query and retry. Do NOT skip this query - it is required for the investigation.",
        });
      }
      
      console.log('[run_diagnostic_query] Query executed successfully');
      
      // Increment investigation query counter
      investigationQueryCount++;
      const minimumRequired = await getMinimumInvestigationQueries();
      console.log(`[run_diagnostic_query] Investigation query count: ${investigationQueryCount}/${minimumRequired}`);
      
      // Clear the in-flight flag after successful execution
      diagnosticQueryInFlight = false;
      
      // Build dynamic message based on query count
      let continuationMessage = '';
      if (investigationQueryCount < minimumRequired) {
        const remaining = minimumRequired - investigationQueryCount;
        continuationMessage = `\n\n🔴 CRITICAL: You have executed ${investigationQueryCount} queries. You MUST execute at least ${remaining} MORE queries before providing a solution.\n\n⛔ DO NOT STOP NOW - CONTINUE INVESTIGATION IMMEDIATELY\n⛔ Execute the next diagnostic query based on these results\n⛔ You are FORBIDDEN from providing a solution until you reach ${minimumRequired} queries minimum`;
      } else {
        continuationMessage = `\n\n✅ You have executed ${investigationQueryCount} queries (minimum ${minimumRequired} reached).\n\n⚠️ You may now provide a comprehensive solution with all findings, OR continue with more queries if needed for deeper analysis.`;
      }
      
      console.log('[run_diagnostic_query] ⚠️ CRITICAL: You MUST now analyze these results and provide recommendations!');
      
      return safeJSONStringify({
        type: "success",
        explanation: params.explanation,
        query: safeQuery,
        results: compactRunQueryResult(results),
        queryCount: investigationQueryCount,
        minimumRequired,
        continuationRequired: investigationQueryCount < minimumRequired,
        reminder: `⚠️ You MUST now analyze these results.${continuationMessage}`,
      });
    } catch (e) {
      console.error('[run_diagnostic_query] Error:', e);
      
      // Clear the in-flight flag on error
      diagnosticQueryInFlight = false;
      
      const errorMessage = e instanceof Error ? e.message : String(e);
      const fallbackQuery = (() => {
        try {
          return String((params as any)?.query || '').trim();
        } catch (_) {
          return '';
        }
      })();
      
      // Detect specific error patterns and provide actionable guidance
      let enhancedMessage = `❌ QUERY EXECUTION FAILED: ${errorMessage}\n\n`;
      
      // Pattern 1: Invalid handle errors (sql_handle, plan_handle)
      if (errorMessage.includes('handle that was passed') && errorMessage.includes('was invalid')) {
        enhancedMessage += '🔴 INVALID HANDLE ERROR:\n';
        enhancedMessage += 'The sql_handle or plan_handle you used is no longer valid (session ended, query completed, or handle expired).\n\n';
        enhancedMessage += '✅ SOLUTION: Do NOT retry with the same handle. Instead:\n';
        enhancedMessage += '1. Query sys.dm_exec_requests again to get CURRENT active sessions\n';
        enhancedMessage += '2. Use CROSS APPLY to get SQL text inline: SELECT r.*, t.text FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
        enhancedMessage += '3. Skip this handle and continue with other investigation queries\n\n';
        enhancedMessage += '⚠️ DO NOT keep retrying the same handle - it will fail every time!\n';
      }
      // Pattern 2: Invalid column name in sys.dm_exec_sql_text context
      else if (errorMessage.includes('Invalid column name') && errorMessage.includes('sql_handle')) {
        enhancedMessage += '🔴 INVALID COLUMN REFERENCE:\n';
        enhancedMessage += 'You cannot use column names directly in sys.dm_exec_sql_text() - it requires a binary value.\n\n';
        enhancedMessage += '✅ SOLUTION: Use CROSS APPLY instead:\n';
        enhancedMessage += 'Correct: SELECT r.*, t.text FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
        enhancedMessage += 'Incorrect: SELECT text FROM sys.dm_exec_sql_text(sql_handle) WHERE session_id = X\n\n';
      }
      // Pattern 3: Truncated query
      else if (errorMessage.includes('compile errors') || fallbackQuery.trim().endsWith('FR') || fallbackQuery.trim().endsWith('AS q')) {
        enhancedMessage += '🔴 INCOMPLETE QUERY:\n';
        enhancedMessage += 'The query appears to be truncated or incomplete.\n\n';
        enhancedMessage += '✅ SOLUTION: Regenerate the complete query with all clauses.\n\n';
      }
      
      enhancedMessage += '⚠️ CONTINUE INVESTIGATION: Move to the next diagnostic query. Do NOT stop the investigation due to this error.';
      
      return safeJSONStringify({
        type: "error",
        message: enhancedMessage,
        query: fallbackQuery,
        originalError: errorMessage,
      });
    }
  },
});

export const get_query_text = tool({
  description: "Get the current SQL query text from the active query editor tab. 🚨 WHEN TO CALL THIS TOOL: (1) User asks to OPTIMIZE, IMPROVE, FIX, TUNE, ANALYZE, DEBUG, or REWRITE a query/procedure/statement, (2) User mentions performance issues like 'slow', 'takes minutes', 'runs slowly', 'performance problem', (3) User says 'this query', 'the query', 'this procedure', 'the stored procedure', (4) User asks 'what's wrong with', 'why is this slow', 'how to speed up', (5) User wants to 'add indexes', 'improve execution plan', 'reduce cost'. ✅ CALL FOR: 'optimize this stored procedure', 'fix slow query', 'improve performance', 'what's wrong with this', 'rewrite this query', 'I have a query that runs slowly'. ❌ DO NOT CALL FOR: (1) General questions like 'How do I create an index?', 'What is a CTE?', 'Explain joins', (2) Creating NEW queries from scratch, (3) Questions about concepts without referencing existing code. IMPORTANT: After calling this tool, you MUST analyze the query, generate the optimized version, and call insert_sql (in Code Mode) to replace it. Do NOT stop after getting the query text.",
  parameters: z.object({}),
  execute: async () => {
    try {
      console.log('[get_query_text] ⚠️ WARNING: This tool should only be called for modifying existing queries, not for general questions!');
      console.log('[get_query_text] Starting to fetch query text...');
      // Coalesce repeated calls within a short window to reduce TPM during retries
      const now = Date.now();
      if (lastGetQueryTextAt && (now - lastGetQueryTextAt) < 2000 && lastGetQueryTextValue) {
        console.log('[get_query_text] Returning cached query text (coalesced)');
        return safeJSONStringify({ success: true, query: lastGetQueryTextValue, isEmpty: !lastGetQueryTextValue.trim(), cached: true });
      }
      const queryText = await getQueryText();
      lastGetQueryTextAt = now;
      lastGetQueryTextValue = queryText || '';
      console.log('[get_query_text] Successfully fetched query text:', queryText?.substring(0, 100));
      
      if (!queryText || queryText.trim() === '') {
        console.warn('[get_query_text] Query tab is empty - this tool should not have been called!');
        return safeJSONStringify({
          success: true,
          query: '',
          isEmpty: true,
          warning: "⚠️ The query tab is empty. This tool should NOT have been called for this request.",
          message: "The user is asking a general question or wants a NEW query. Answer their question directly using your knowledge and the expert knowledge packs. DO NOT call get_query_text again."
        });
      }
      
      return safeJSONStringify({
        success: true,
        query: queryText,
        isEmpty: false,
        next_step: "⚠️ CRITICAL: You MUST now generate the improved/modified query based on the user's request and call insert_sql to replace the query in the tab. Do NOT stop here. Complete the workflow NOW."
      });
    } catch (e) {
      console.error('[get_query_text] Error:', e);
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        warning: "⚠️ This tool likely should not have been called.",
        fallback: "The user is asking a general question or wants a NEW query. Answer their question directly using your knowledge and the expert knowledge packs. DO NOT call get_query_text again."
      });
    }
  },
});

export const insert_sql = tool({
  description: "Insert SQL code into the query editor tab. 🚨 CODE MODE ONLY 🚨 This tool is ONLY available in CODE MODE. CRITICAL: This tool works whether a query tab is open or not. If NO tab is open, it automatically creates a new tab and inserts the SQL. If a tab IS open, it inserts into the active tab. NEVER ask 'should I create a tab?' - just call this tool. AFTER inserting, you must ASK the user in chat if they want to run the current query and only call run_current_query if they explicitly say Yes. If they say No or decline, you must NOT execute anything and should end the turn after confirming the SQL was inserted.",
  parameters: z.object({
    sql: z.string().min(1).describe("The SQL text to insert into the editor. CRITICAL VALIDATION: Before generating SQL, you MUST verify that every table and column you use exists in the database schema by calling get_tables and get_columns. Do NOT invent or assume any table or column names. Only use tables and columns that you have confirmed exist through the schema tools."),
    overwrite: z.boolean().nullable().describe("If true and the active tab has content, replace the entire editor with this SQL instead of opening a new tab. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      const now = Date.now();
      if (lastInsertCooldownUntil && now < lastInsertCooldownUntil) {
        console.warn('[insert_sql] ⛔ COOLDOWN - Recent insert just completed; skipping duplicate insert');
        return safeJSONStringify({ success: true, coalesced: true, message: 'Recent insert completed; duplicate insert ignored.' });
      }
      // CRITICAL: Prevent duplicate insert_sql calls, but allow one more if:
      // - previous insert finished, AND
      // - the new SQL differs (e.g., adding SHOWPLAN/STATISTICS wrappers)
      if (insertSqlAccepted || insertSqlExecuting) {
        if (!insertSqlExecuting) {
          const sinceComplete = lastInsertCompletedAt ? (Date.now() - lastInsertCompletedAt) : 0;
          const lastTrim = (lastInsertedSqlContent || '').trim();
          const nextTrim = (params.sql || '').trim();
          const isDifferent = lastTrim !== nextTrim;
          if (lastInsertCompletedAt && sinceComplete > 150 && isDifferent) {
            // Relax guard to allow a meaningful second insert within the same turn
            insertSqlAccepted = false;
          }
        }
      }
      if (insertSqlAccepted || insertSqlExecuting) {
        // Debounce the noisy block log to at most once per 1.5s
        const nowTs = Date.now();
        if (nowTs - lastInsertBlockLogAt > 1500) {
          console.log('[insert_sql] ⛔ BLOCKED - Another insert_sql is already executing');
          lastInsertBlockLogAt = nowTs;
        }
        return safeJSONStringify({
          success: true,
          coalesced: true,
          message: "Another insert_sql is already executing this turn. Duplicate call ignored.",
        });
      }
      
      insertSqlExecuting = true;
      // Track whether we performed an overwrite (so we don't insert again)
      let insertedViaOverwrite = false;
      // Capture verification content if we overwrote
      let afterOverwriteCapture = '';
      // If needed, build a combined content (Original/Rewritten) once.
      try {
        const hasOriginalMarker = /--\s*Original\s+query/i.test(params.sql);
        const hasRewrittenMarker = /--\s*Rewritten\s+query/i.test(params.sql);
        let currentEditor = '';
        try { currentEditor = await getQueryText(); } catch {}
        const editorHasOriginal = /--\s*Original\s+query/i.test(currentEditor || '');
        const editorHasRewritten = /--\s*Rewritten\s+query/i.test(currentEditor || '');
        const shouldWrap = !hasOriginalMarker && !hasRewrittenMarker && !!currentEditor && currentEditor.trim() && !editorHasOriginal && !editorHasRewritten && currentEditor.trim() !== params.sql.trim();
        if (shouldWrap) {
          const combined = [
            '-- Original query',
            currentEditor.trim(),
            '',
            '-- Optimization notes:',
            '-- (added by AI)',
            '',
            '-- Rewritten query:',
            params.sql.trim()
          ].join('\n');
          params.sql = combined;
        }
      } catch {}
      // Cache latest SQL for potential self-heal by run_current_query
      try { lastInsertedSqlContent = params.sql; } catch {}
      console.log('[insert_sql] ✅ Execution started, flag set to prevent duplicates');
      
      try {
        // Mark as accepted for this assistant turn immediately so any later calls in the same
        // response are blocked even after this execution completes.
        insertSqlAccepted = true;
        // If we just opened a tab very recently, wait a brief moment to let the host settle
        try {
          const sinceOpen = Date.now() - lastTabOpenAt;
          if (lastTabOpenAt && sinceOpen < 700) {
            const waitMs = 700 - sinceOpen;
            console.log(`[insert_sql] Waiting ${waitMs}ms for newly opened tab to settle`);
            await sleep(waitMs);
          }
        } catch {}
        // Strict requirement: an existing empty active tab must be present
        let tabList = await getTabList();
        let tabs = Array.isArray(tabList) ? tabList : (tabList?.tabs || []);
        // Retry longer if host hasn't populated tabs yet (~3s total)
        if (!tabs || tabs.length === 0) {
          for (let i = 0; i < 12; i++) {
            await sleep(250);
            tabList = await getTabList();
            tabs = Array.isArray(tabList) ? tabList : (tabList?.tabs || []);
            if (tabs && tabs.length > 0) break;
          }
          if (!tabs || tabs.length === 0) {
            console.warn('[insert_sql] No tabs detected after extended wait (~3s)');
          }
        }
        console.log('[insert_sql] Tab check - found', tabs?.length || 0, 'tabs');
        const active = (tabs && tabs.find((t:any)=>t.active)) || (tabs && tabs[tabs.length-1]);
        if (!active) {
          // No tabs at all → require open_new_tab upstream
          // IMPORTANT: allow a second insert_sql after open_new_tab by clearing acceptance guard
          try { insertSqlAccepted = false; } catch {}
          return safeJSONStringify({
            type: 'error',
            code: 'needsOpenTab',
            message: 'No query tab is open. You must call open_new_tab before insert_sql.'
          });
        }
        // Try to switch to detected tab to ensure getQueryText probes the right editor
        try { if (typeof active.id === 'number') await switchToTab(active.id); } catch {}
        // Probe current editor content to determine if tab is empty (more reliable than flags)
        let existing = '';
        try { existing = await getQueryText(); } catch { existing = ''; }
        const normEq = (a: string, b: string) => (a || '').replace(/\r\n/g, '\n').trim() === (b || '').replace(/\r\n/g, '\n').trim();
        // If editor already contains exactly the incoming SQL, short-circuit to avoid loops
        if (normEq(existing, params.sql)) {
          try { lastInsertedSqlContent = params.sql; lastInsertCompletedAt = Date.now(); } catch {}
          lastInsertCooldownUntil = Date.now() + 1200;
          return safeJSONStringify({
            success: true,
            coalesced: true,
            message: 'Editor already up to date; skipping insert.',
            verification: { matched: true }
          });
        }
        const hasExisting = !!existing && existing.trim().length > 0;
        if (hasExisting) {
          // If overwrite explicitly disabled, open a NEW tab and insert there
          if (params.overwrite === false) {
            console.log('[insert_sql] Active tab has content and overwrite=false -> opening new tab');
            await createNewTab(params.sql);
            // give the host a moment to focus the new tab and render
            await sleep(300);
            // Try to verify in the (presumably active) new tab
            let afterOverwrite = '';
            try { afterOverwrite = await getQueryText(); } catch { afterOverwrite = ''; }
            insertedViaOverwrite = true; // reuse verification path below
            afterOverwriteCapture = afterOverwrite || '';
          } else {
            // Default to overwrite in the current active tab
            console.log('[insert_sql] Overwrite mode enabled - replacing existing editor content');
            try { await setQueryText(params.sql); } catch (e) { /* fallback later */ }
            // small settle time
            await sleep(200);
            let afterOverwrite = '';
            try { afterOverwrite = await getQueryText(); } catch { afterOverwrite = ''; }
            const norm = (s: string) => (s || '').replace(/\r\n/g, '\n').trim();
            const verifiedOverwrite = !!afterOverwrite && norm(afterOverwrite) === norm(params.sql);
            if (!verifiedOverwrite) {
              // fallback to insertText if set failed
              try { await setQueryText(''); } catch {}
              await insertText(params.sql);
              await sleep(250);
              try { afterOverwrite = await getQueryText(); } catch { afterOverwrite = ''; }
            }
            insertedViaOverwrite = true;
            afterOverwriteCapture = afterOverwrite || '';
            // proceed to normal verification flow below
          }
        }
      } finally {
        // Only reset in-flight mutex; keep insertSqlAccepted true for this turn
        insertSqlExecuting = false;
        console.log('[insert_sql] ✅ Execution completed, in-flight mutex reset');
      }
      
      // Read existing text (best-effort)
      let before = '';
      try { before = await getQueryText(); } catch (e) { /* ignore */ }

      let after = '';
      let verified = false;
      if (insertedViaOverwrite) {
        // We already set/replaced the editor; reuse captured verification
        after = afterOverwriteCapture;
        const norm = (s: string) => (s || '').replace(/\r\n/g, '\n').trim();
        verified = !!after && norm(after) === norm(params.sql);
      } else {
        // Attempt to insert into current tab
        await insertText(params.sql);
        // Small delay to allow UI to update (increase to 250ms)
        await new Promise((r) => setTimeout(r, 250));
        // Verify
        try { after = await getQueryText(); } catch (e) { /* ignore */ }
        const norm = (s: string) => (s || '').replace(/\r\n/g, '\n').trim();
        verified = !!after && norm(after) === norm(params.sql);
      }

      // If verification failed in current tab, as a last resort open a new tab and try there
      if (!verified) {
        try {
          console.warn('[insert_sql] Verification failed in current tab; opening new tab as fallback');
          await createNewTab(params.sql);
          await sleep(350);
          try { after = await getQueryText(); } catch { after = ''; }
          const norm2 = (s: string) => (s || '').replace(/\r\n/g, '\n').trim();
          verified = !!after && norm2(after) === norm2(params.sql);
        } catch {}
      }
      if (!verified) {
        return safeJSONStringify({
          type: 'error',
          code: 'verifyFailed',
          message: 'Failed to verify SQL insertion after fallback open_new_tab.'
        });
      }

      const norm = (s: string) => (s || '').replace(/\r\n/g, '\n').trim();
      const finalVerified = !!after && norm(after) === norm(params.sql);
      try { lastInsertCompletedAt = Date.now(); } catch {}

      console.log('[insert_sql] ✅ Execution completed, in-flight mutex reset');
      // Short cooldown (1.5s) to avoid immediate duplicate inserts within same turn burst
      lastInsertCooldownUntil = Date.now() + 1500;
      return safeJSONStringify({
        success: true,
        message: finalVerified
          ? "SQL is present in the editor."
          : "Attempted insertion and tab creation; could not confirm editor contents.",
        verification: {
          beforePreview: before ? before.substring(0, 60) : '',
          afterPreview: after ? after.substring(0, 60) : '',
          matched: finalVerified,
        },
        next_action: "CODE MODE: Clearly TELL the user that the SQL has been inserted, then ASK if they want you to run the current query now (Yes/No). Only if they explicitly say Yes/Run/Execute should you call run_current_query. If they say No or do not confirm, do NOT call any execution tools. Instead, end the response with a short note that the query is ready in the editor and they can review and run it themselves whenever they like.",
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const open_new_tab = tool({
  description: "Open a new query tab in SQLMind Studio. 🚨 CRITICAL: This tool is ONLY available in CODE MODE. In CHAT MODE, this tool is DISABLED. Use this when the user explicitly asks to open a new tab or create a new query tab.",
  parameters: z.object({
    query: z.string().nullable().describe("Optional SQL query to populate the new tab with. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      // Coalesce duplicate open_new_tab calls in the same assistant turn
      if (openNewTabExecutedThisTurn) {
        return safeJSONStringify({
          success: true,
          coalesced: true,
          message: 'A new tab was already opened this turn; duplicate call ignored.'
        });
      }

      await openTab("query", params.query ? { query: params.query } : undefined);
      openNewTabExecutedThisTurn = true;
      try { lastTabOpenAt = Date.now(); } catch {}
      return safeJSONStringify({
        success: true,
        message: "New query tab opened successfully",
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const complete_query = tool({
  description: "Complete or suggest the rest of a SQL query based on what the user has typed so far. Use this when the user asks for query completion, autocomplete, or to finish their query. Also use this to suggest queries from scratch based on database schema when the query tab is empty.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const text = await getQueryText();
      
      return safeJSONStringify({
        success: true,
        currentQuery: text,
        message: "Current query text retrieved. Generate a completion and use insert_sql to replace the entire query with the completed version, or use insert_text_at_cursor to append."
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const insert_text_at_cursor = tool({
  description: "Insert text at the current cursor position in the query editor. 🚨 CRITICAL: This tool is ONLY available in CODE MODE. In CHAT MODE, this tool is DISABLED. Use this to insert query completions or suggestions at the cursor.",
  parameters: z.object({
    text: z.string().describe("The text to insert at cursor position"),
  }),
  execute: async (params) => {
    try {
      await insertTextAtCursor(params.text);
      return safeJSONStringify({
        success: true,
        message: "Text inserted at cursor successfully",
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

// Wrapper function to get query results from active tab
async function getQueryResults(resultIndex?: number): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'getQueryResults',
        args: resultIndex !== undefined ? { resultIndex } : {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[getQueryResults] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to get query results'));
          } else {
            console.log('[getQueryResults] Successfully retrieved query results');
            resolve(event.data.result);
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[getQueryResults] Sending request to get query results');
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[getQueryResults] Request timed out after 3 seconds');
          reject(new Error('Timeout waiting for query results'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[getQueryResults] Exception:', e);
      reject(new Error('Failed to get query results: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to switch database
export async function switchDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'switchDatabase',
        args: { databaseName }
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[switchDatabase] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to switch database'));
          } else {
            console.log('[switchDatabase] Successfully switched to database:', databaseName);
            resolve();
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[switchDatabase] Sending request to switch to:', databaseName);
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[switchDatabase] Request timed out after 10 seconds');
          reject(new Error('Timeout waiting for database switch - the database may be switching but taking longer than expected. Please check the database dropdown in SQLMind Studio.'));
        }, 10000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[switchDatabase] Exception:', e);
      reject(new Error('Failed to switch database: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to get list of all open tabs
async function getTabList(): Promise<any> {
  // Coalesce concurrent/near-concurrent calls
  const now = Date.now();
  if (rawTabListPromise && (now - rawTabListLastAt) < RAW_TABLIST_TTL_MS) {
    return rawTabListPromise;
  }
  rawTabListLastAt = now;
  rawTabListPromise = new Promise((resolve, reject) => {
    try {
      console.log('[getTabList] Sending request to get tab list');
      const requestId = `req_${Date.now()}_${Math.random()}`;
      const message = {
        id: requestId,
        name: 'getTabList',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[getTabList] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to get tab list'));
          } else {
            console.log('[getTabList] Successfully retrieved tab list');
            resolve(event.data.result);
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[getTabList] Sending request to get tab list');
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[getTabList] Request timed out after 3 seconds');
          reject(new Error('Timeout waiting for tab list'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[getTabList] Exception:', e);
      reject(new Error('Failed to get tab list: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to switch to a specific tab by ID
async function switchToTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'switchToTab',
        args: { tabId }
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[switchToTab] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to switch to tab'));
          } else {
            console.log('[switchToTab] Successfully switched to tab:', tabId);
            resolve();
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[switchToTab] Sending request to switch to tab:', tabId);
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[switchToTab] Request timed out after 3 seconds');
          reject(new Error('Timeout waiting to switch tab'));
        }, 3000);
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[switchToTab] Exception:', e);
      reject(new Error('Failed to switch to tab: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

// Wrapper function to execute query in the active tab (triggers the Run button)
async function executeQueryInTab(): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const requestId = `req_${Date.now()}_${Math.random()}`;
      
      const message = {
        id: requestId,
        name: 'executeQueryInTab',
        args: {}
      };
      
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const responseHandler = (event: MessageEvent) => {
        if (event.data && event.data.id === requestId) {
          window.removeEventListener('message', responseHandler);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (resolved) return;
          resolved = true;
          
          if (event.data.error) {
            console.warn('[executeQueryInTab] Received error response:', event.data.error);
            reject(new Error(event.data.error.message || 'Failed to execute query in tab'));
          } else {
            console.log('[executeQueryInTab] Query executed successfully in tab');
            resolve(event.data.result);
          }
        }
      };
      
      window.addEventListener('message', responseHandler);
      
      if (window.parent && window.parent !== window) {
        console.log('[executeQueryInTab] Sending request to execute query in tab');
        window.parent.postMessage(message, '*');
        
        timeoutId = setTimeout(() => {
          window.removeEventListener('message', responseHandler);
          if (resolved) return;
          resolved = true;
          console.warn('[executeQueryInTab] Request timed out after 30 seconds');
          reject(new Error('Timeout waiting for query execution - the query may still be running. Please check the query tab.'));
        }, 30000); // 30 second timeout for query execution
      } else {
        reject(new Error('Unable to communicate with main app'));
      }
    } catch (e) {
      console.error('[executeQueryInTab] Exception:', e);
      reject(new Error('Failed to execute query in tab: ' + (e instanceof Error ? e.message : String(e))));
    }
  });
}

export const switch_database = tool({
  description: "Switch to a different database in SQLMind Studio. This will change the active database in the UI dropdown and all subsequent queries will run against the new database. Use this when the user needs to work with a different database or when diagnostic procedures like sp_Blitz are in a different database (e.g., master).",
  parameters: z.object({
    database_name: z.string().describe("The name of the database to switch to (e.g., 'master', 'AdventureWorks2019', 'DBA')"),
  }),
  execute: async (params) => {
    try {
      await switchDatabase(params.database_name);
      
      // Mark the timestamp of database switch to allow one diagnostic query after it
      lastSwitchDatabaseAt = Date.now();
      console.log('[switch_database] Database switched, allowing one diagnostic query in same response');
      
      return safeJSONStringify({
        success: true,
        message: `Successfully switched to database: ${params.database_name}`,
        database: params.database_name,
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const get_query_results = tool({
  description: "Get query results OR error information from the active query tab. Returns successful results and SQL errors. CRITICAL: Focus on key metrics; results are compacted to avoid token limits. You can request a specific result set either by 0-based index (result_index) or 1-based number (result_number).",
  parameters: z.object({
    result_index: z.number().nullable().describe("0-based index of the result set to retrieve (0 = first). Use null to omit."),
    result_number: z.number().nullable().describe("1-based result number to retrieve (1 = first). If both are provided, result_index takes precedence. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      // Normalize target index: prefer explicit 0-based, else convert 1-based to 0-based
      const targetIndex = (typeof params.result_index === 'number' && params.result_index !== null)
        ? params.result_index
        : (typeof params.result_number === 'number' && params.result_number !== null
          ? Math.max(0, params.result_number - 1)
          : undefined);

      let results = await getQueryResults(targetIndex);
      console.log('[get_query_results] Raw results received:', JSON.stringify(results).substring(0, 500));
      
      // If results indicate not ready yet, poll briefly (up to ~4s)
      const notReadyMsg = 'No query results available in the active tab. Please execute the query first.';
      if (!results || results.message === notReadyMsg) {
        const start = Date.now();
        while (Date.now() - start < 4000) {
          await sleep(250);
          try {
            results = await getQueryResults(targetIndex);
            if (results && results.message !== notReadyMsg) break;
          } catch {}
        }
        if (!results || results.message === notReadyMsg) {
          console.log('[get_query_results] Still no results after polling');
          return safeJSONStringify({
            success: false,
            noResults: true,
            message: notReadyMsg,
            nextStep: "Call run_current_query to execute the query, then call get_query_results again."
          });
        }
      } 
      
      // Check if results contain error information
      if (results && (results.error || results.errorMessage)) {
        console.log('[get_query_results] Query execution error detected:', results.error || results.errorMessage);
        return safeJSONStringify({
          success: false,
          hasError: true,
          error: results.error || results.errorMessage,
          errorDetails: results.errorDetails || results,
          nextStep: "⚠️ Query execution failed. Call get_query_text to see the query, identify the issue, fix it, and call insert_sql with the corrected query."
        });
      }
      
      // Check if query returned 0 rows (empty result set)
      // Results structure: { results: [{ rows: [...], fields: [...] }] }
      const firstResult = results?.results?.[0];
      const hasData = firstResult && firstResult.rows && Array.isArray(firstResult.rows) && firstResult.rows.length > 0;
      if (!hasData) {
        console.log('[get_query_results] Query executed successfully but returned 0 rows (empty result set)');
        return safeJSONStringify({
          success: true,
          emptyResultSet: true,
          rowCount: 0,
          affectedRows: results?.affectedRows || 0,
          message: "Query executed successfully but returned 0 rows. The result set is empty.",
          interpretation: "This means the query conditions did not match any data in the database. This could indicate: 1) The data doesn't exist, 2) The WHERE clause is too restrictive, 3) The table is empty, or 4) The query logic needs adjustment.",
          columns: firstResult?.fields || [],
          reminder: "⚠️ IMPORTANT: Inform the user that the query returned no results (0 rows). Explain what this means and suggest next steps if appropriate."
        });
      }
      
      // Build compact payload to avoid token overflow
      const allSets: any[] = Array.isArray(results?.results) ? results.results : [];
      const selected = (typeof targetIndex === 'number')
        ? (allSets[targetIndex] ?? allSets[0])
        : null;

      // If host ignored filtering and returned all sets, slice locally when targetIndex specified
      const workingSets: any[] = (typeof targetIndex === 'number')
        ? (selected ? [selected] : [])
        : allSets;

      const compactOne = (set: any) => {
        const rows: any[] = Array.isArray(set?.rows) ? set.rows : [];
        const fields: any[] = Array.isArray(set?.fields) ? set.fields : [];
        const colNames = fields.map((f: any) => f?.name ?? f?.id ?? '');
        // Basic numeric stats for up to first 12 columns
        const stats: Record<string, any> = {};
        for (let i = 0; i < Math.min(colNames.length, 12); i++) {
          const name = String(colNames[i] ?? `c${i}`);
          const vals: number[] = [];
          for (let r = 0; r < rows.length; r++) {
            const v = rows[r]?.[name] ?? rows[r]?.[`c${i}`];
            const num = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);
            if (num !== null) vals.push(num);
          }
          if (vals.length) {
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            stats[name] = { count: vals.length, min, max, avg };
          }
        }
        return {
          rowCount: rows.length,
          columnCount: colNames.length,
          columns: colNames,
          sampleRows: rows.slice(0, 30),
          numericStats: stats,
        };
      };

      const compact = workingSets.map(compactOne);
      console.log('[get_query_results] Successfully retrieved query results (compacted)');
      return safeJSONStringify({
        success: true,
        compact: true,
        selectedIndex: typeof targetIndex === 'number' ? targetIndex : undefined,
        resultCount: allSets.length,
        results_compact: compact,
        reminder: "⚠️ Analyze the compacted results and provide recommendations. If you need raw details from a specific row/column, ask for it explicitly."
      });
    } catch (e) {
      console.error('[get_query_results] Exception:', e);
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        nextStep: "The query tab may not have results yet. Try calling run_current_query first."
      });
    }
  },
});

export const get_tab_list = tool({
  description: "Get a list of all open query tabs with their IDs, titles, and positions. Use this when the user asks about tabs, wants to see what tabs are open, or wants to switch to a specific tab by number. Each tab has an ID that can be used with switch_to_tab.",
  parameters: z.object({}),
  execute: async () => {
    try {
      // Coalesce duplicate get_tab_list calls in the same assistant turn
      if (getTabListInFlight && lastGetTabListResult) {
        console.log('[get_tab_list] Coalesced - returning cached result');
        return safeJSONStringify(lastGetTabListResult);
      }
      getTabListInFlight = true;
      // If we very recently opened a tab, the host may not report it immediately. Retry briefly.
      let tabs: any;
      for (let attempt = 0; attempt < 20; attempt++) { // extend retries up to ~4s total
        // Small delay if a tab was just opened
        const sinceOpen = Date.now() - (lastTabOpenAt || 0);
        const wait = sinceOpen < 1200 ? 200 : 50;
        if (sinceOpen < 4000) await new Promise(r => setTimeout(r, wait));
        tabs = await getTabList();
        // When host returns structured array with query tabs, accept; else, retry once
        const rawTabs = Array.isArray(tabs) ? tabs : (tabs && Array.isArray(tabs.tabs) ? tabs.tabs : []);
        if (rawTabs.length > 0) { tabs = rawTabs; break; }
      }
      // One last conservative wait if still empty right after an open
      if ((Array.isArray(tabs) ? tabs : []).length === 0 && Date.now() - (lastTabOpenAt || 0) < 5000) {
        await new Promise(r => setTimeout(r, 250));
        const t2 = await getTabList();
        const raw2 = Array.isArray(t2) ? t2 : (t2 && Array.isArray(t2.tabs) ? t2.tabs : []);
        if (raw2.length > 0) tabs = raw2;
      }
      console.log('[get_tab_list] Successfully retrieved tab list:', tabs);
      
      // Sort tabs by position to show them in order
      const raw = Array.isArray(tabs) ? tabs : (tabs && Array.isArray(tabs.tabs) ? tabs.tabs : []);
      const sortedTabs = Array.isArray(raw) ? raw.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)) : [];
      
      // Create a user-friendly summary
      // Do NOT filter by tabType; include all tabs to avoid empty summary across hosts
      const summary = sortedTabs.map((tab: any, index: number) => ({
        tabNumber: index + 1,
        id: tab.id,
        title: tab.title,
        active: tab.active,
        hasContent: tab.hasContent
      }));
      
      const payload = {
        success: true,
        tabs: summary,
        totalQueryTabs: summary.length,
        message: `Found ${summary.length} tab(s). You can reference them by tab number or switch to them using switch_to_tab.`
      };
      lastGetTabListResult = payload;
      return safeJSONStringify(payload);
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      getTabListInFlight = false;
    }
  },
});

export const switch_to_tab = tool({
  description: "Switch to a specific query tab by its ID. 🚨 CRITICAL: This tool is ONLY available in CODE MODE. In CHAT MODE, this tool is DISABLED. Use this after calling get_tab_list to get the tab IDs. This allows you to switch to a different tab before executing queries or reading query text.",
  parameters: z.object({
    tab_id: z.number().describe("The ID of the tab to switch to (obtained from get_tab_list)"),
  }),
  execute: async (params) => {
    try {
      await switchToTab(params.tab_id);
      return safeJSONStringify({
        success: true,
        message: `Successfully switched to tab with ID ${params.tab_id}`,
        tabId: params.tab_id,
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

export const get_execution_plan = tool({
  description: "Read the execution plan XML from the active query tab or a specific tab. Use this when the user asks to analyze, check, or read the execution plan. The execution plan must have been collected by running a query with execution plan collection enabled.",
  parameters: z.object({
    tab_id: z.number().nullable().describe("Optional tab ID to get execution plan from. If not provided, uses the active tab. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      let planData;
      
      if (typeof params.tab_id === 'number' && params.tab_id !== null) {
        planData = await getTabExecutionData(params.tab_id);
      } else {
        planData = await getExecutionPlan();
      }
      
      if (!planData.planXml && (!planData.planXmls || planData.planXmls.length === 0)) {
        return safeJSONStringify({
          success: false,
          message: "No execution plan available in this tab. Please run a query with execution plan collection enabled first.",
          hint: "To collect execution plans, enable the 'Collect Actual Plan' or 'Collect Estimated Plan' button in the toolbar before running the query."
        });
      }
      
      return safeJSONStringify({
        success: true,
        planXml: planData.planXml,
        planXmls: planData.planXmls,
        planCount: planData.planXmls ? planData.planXmls.length : (planData.planXml ? 1 : 0),
        message: "Execution plan retrieved successfully. You can now analyze it for performance issues, missing indexes, or optimization opportunities."
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        hint: "Make sure you're in a query tab and have executed a query with execution plan collection enabled."
      });
    }
  },
});

export const get_statistics = tool({
  description: "Read the statistics data (IO and TIME statistics) from the active query tab or a specific tab. Use this when the user asks to analyze, check, or read statistics. The statistics must have been collected by running a query with statistics collection enabled.",
  parameters: z.object({
    tab_id: z.number().nullable().describe("Optional tab ID to get statistics from. If not provided, uses the active tab. Use null to omit."),
  }),
  execute: async (params) => {
    try {
      let statsData;
      
      if (typeof params.tab_id === 'number' && params.tab_id !== null) {
        const tabData = await getTabExecutionData(params.tab_id);
        statsData = { statsData: tabData.statsData };
      } else {
        statsData = await getStatisticsData();
      }
      
      if (!statsData.statsData) {
        return safeJSONStringify({
          success: false,
          message: "No statistics data available in this tab. Please run a query with statistics collection enabled first.",
          hint: "To collect statistics, enable the 'Statistics' button in the toolbar or include 'SET STATISTICS IO ON; SET STATISTICS TIME ON;' in your query."
        });
      }
      
      return safeJSONStringify({
        success: true,
        statsData: statsData.statsData,
        message: "Statistics data retrieved successfully. You can now analyze IO patterns, logical reads, and execution times."
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        hint: "Make sure you're in a query tab and have executed a query with statistics collection enabled."
      });
    }
  },
});

export const get_messages = tool({
  description: "Read the messages data from the active query tab. This includes SQL Server informational messages (PRINT statements, DBCC output), query completion status, errors, and execution time. Use this when the user asks to read, check, or analyze messages from the Messages tab.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const messagesData = await getMessagesData();
      
      if (!messagesData.messages || messagesData.messages.length === 0) {
        return safeJSONStringify({
          success: false,
          message: "No messages available in this tab. Please execute a query first.",
          hint: "Messages appear after running queries and include PRINT output, DBCC results, errors, and status information."
        });
      }
      
      return safeJSONStringify({
        success: true,
        messages: messagesData.messages,
        messageCount: messagesData.messages.length,
        message: "Messages data retrieved successfully. You can now analyze the query execution messages, errors, and informational output."
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        hint: "Make sure you're in a query tab and have executed a query."
      });
    }
  },
});

// Wrapper function to close a tab (active by default or by id)
async function closeTab(tabId?: number): Promise<void> {
  const tryNames = ['closeTab', 'tab:close', 'closeActiveTab'];
  const args = typeof tabId === 'number' ? { id: tabId } : {};
  let lastErr: any = null;
  for (const name of tryNames) {
    try {
      await new Promise<void>((resolve, reject) => {
        const requestId = `req_${Date.now()}_${Math.random()}`;
        const message = { id: requestId, name, args } as any;
        let timeoutId: NodeJS.Timeout | null = null;
        const handler = (event: MessageEvent) => {
          if (event.data && event.data.id === requestId) {
            window.removeEventListener('message', handler as any);
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            const errMsg = event.data?.error?.message || event.data?.error;
            if (errMsg && String(errMsg).toLowerCase().includes('unknown request')) {
              return reject(new Error('UnknownRequest'));
            }
            if (event.data && event.data.error) {
              return reject(new Error(event.data.error.message || 'Failed to close tab'));
            }
            resolve();
          }
        };
        window.addEventListener('message', handler as any);
        if (window.parent && window.parent !== window) {
          const targetLabel = (typeof tabId === 'number') ? String(tabId) : '(active)';
          console.log('[closeTab] Sending request to close tab via', name, targetLabel);
          window.parent.postMessage(message, '*');
          // Short timeout so we can try the next alias quickly
          timeoutId = setTimeout(() => {
            try { window.removeEventListener('message', handler as any); } catch {}
            reject(new Error('Timeout'));
          }, 1200);
        } else {
          reject(new Error('NoParent'));
        }
      });
      // Success
      return;
    } catch (e) {
      lastErr = e;
      // Unknown request or timeout: try next alias
      continue;
    }
  }
  throw new Error('Failed to close tab: ' + (lastErr instanceof Error ? lastErr.message : String(lastErr)));
}

// Close the current active tab (or a specific tab by id)
export const close_current_tab = tool({
  description: 'Close the active query tab. Optionally specify a tab_id to close a specific tab.',
  parameters: z.object({
    tab_id: z.number().int().nullable().describe('Optional tab id to close. If omitted, closes the active tab. Use null to omit.'),
  }),
  execute: async (params) => {
    try {
      // Normalize potential id inputs: accept tab_id | id | tabId, and coerce numeric strings
      const rawId: any = (params as any)?.tab_id ?? (params as any)?.id ?? (params as any)?.tabId;
      let idNum: number | undefined = undefined;
      if (typeof rawId === 'number' && Number.isFinite(rawId)) {
        idNum = rawId;
      } else if (typeof rawId === 'string' && rawId.trim() !== '' && !isNaN(Number(rawId))) {
        idNum = Number(rawId);
      }

      if (typeof idNum === 'number') {
        console.log('[close_current_tab] Closing specific tab by id:', idNum);
        await closeTab(idNum);
        return safeJSONStringify({ success: true, message: `Closed tab ${idNum}` });
      }
      // No id provided; close the active tab if any
      try {
        const tl = await getTabList();
        const tabs = Array.isArray(tl) ? tl : (tl && Array.isArray(tl.tabs) ? tl.tabs : []);
        const active = tabs.find((t:any)=>t.active);
        if (active && typeof active.id === 'number') {
          console.log('[close_current_tab] No id provided; closing detected active tab id:', active.id);
          await closeTab(active.id);
          return safeJSONStringify({ success: true, message: `Closed active tab ${active.id}` });
        }
      } catch {}
      // Fall back: ask host to close active without id
      console.log('[close_current_tab] No id and no active tab found via list; requesting host to close active tab');
      await closeTab();
      return safeJSONStringify({ success: true, message: 'Closed active tab' });
    } catch (e) {
      return safeJSONStringify({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
});

// Convenience tool to run the query from the active tab
export const run_current_query = (
  onAskPermission: (toolCallId: string, params: any) => Promise<boolean>,
) =>
  tool({
    description: "Run the SQL query from the current active query tab by triggering the Run button. In CODE MODE this executes in the editor tab and DOES NOT stream result rows back into chat.",
    parameters: z.object({
      query: z.string().nullable().describe("The query text (automatically fetched from the active tab). Use null to omit."),
    }),
    execute: async (params, options) => {
      try {
        // Coalesce duplicate run_current_query calls in the same assistant turn
        if (runCurrentQueryExecutedThisTurn) {
          return safeJSONStringify({
            success: true,
            coalesced: true,
            message: 'Query execution already triggered this turn; duplicate call ignored.'
          });
        }
        // Do NOT require an insert this turn. If insert_sql is currently in-flight, wait briefly; otherwise proceed.
        // If an insert is still in-flight, wait briefly to avoid reading empty editor
        const waitStart = Date.now();
        while (insertSqlExecuting && (Date.now() - waitStart) < 2000) {
          await sleep(100);
        }
        // First, get the query text from the active tab. If empty, poll longer to avoid race after insert_sql
        let queryText = await getQueryText();
        const startWait = Date.now();
        const allowWaitMs = 3000;
        if (!queryText || queryText.trim() === '') {
          // If we recently completed an insert, allow a longer wait
          const sinceInsert = Date.now() - (lastInsertCompletedAt || 0);
          const budget = Math.max(allowWaitMs - sinceInsert, 0);
          const end = Date.now() + budget;
          while ((!queryText || queryText.trim() === '') && Date.now() < end) {
            await new Promise(r => setTimeout(r, 150));
            try { queryText = await getQueryText(); } catch {}
          }
        }
        // Self-heal: if still empty, try to ensure a tab + content using lastInsertedSqlContent
        if (!queryText || queryText.trim() === '') {
          try {
            // Check tabs
            let tl = await getTabList();
            let raw = Array.isArray(tl) ? tl : (tl && Array.isArray(tl.tabs) ? tl.tabs : []);
            if (!raw || raw.length === 0) {
              if (lastInsertedSqlContent) {
                // Open a new tab with cached SQL
                await createNewTab(lastInsertedSqlContent);
                await new Promise(r => setTimeout(r, 250));
                try {
                  tl = await getTabList();
                  raw = Array.isArray(tl) ? tl : (tl && Array.isArray(tl.tabs) ? tl.tabs : []);
                  const active = raw.find((t:any)=>t.active) || raw[raw.length-1];
                  if (active && typeof active.id === 'number') await switchToTab(active.id);
                } catch {}
                // Re-read content
                try { queryText = await getQueryText(); } catch {}
              }
            } else {
              // There is a tab, but content is empty; try to reinsert cached SQL
              if (lastInsertedSqlContent) {
                try { await insertText(lastInsertedSqlContent); } catch {}
                await new Promise(r => setTimeout(r, 200));
                try { queryText = await getQueryText(); } catch {}
              }
            }
          } catch (e) {
            console.warn('[run_current_query] Self-heal attempt failed:', e);
          }
        }

        if (!queryText || queryText.trim() === '') {
          return safeJSONStringify({
            type: "error",
            message: "The query tab is empty. There is no query to run.",
            hint: lastInsertedSqlContent ? "Try calling insert_sql again with the cached SQL." : undefined
          });
        }
        
        // Store the query in params so it can be displayed in the UI
        params.query = queryText;
        
        // Ask for permission to run the query
        const permitted = await onAskPermission(options.toolCallId, { query: queryText });
        if (!permitted) {
          console.log('[run_current_query] User declined to run the query');
          return safeJSONStringify({
            type: "user_declined",
            message: "User declined to run this query. Acknowledge their decision and ask what they'd like to do instead.",
          });
        }
        
        // Execute the query in the tab (triggers the Run button)
        await executeQueryInTab();
        console.log('[run_current_query] Query executed successfully in tab');
        runCurrentQueryExecutedThisTurn = true;

        // Do NOT return rows to chat; only confirm execution to keep output in the editor
        return safeJSONStringify({
          success: true,
          message: 'Query execution started in the editor tab. Results will appear in the Results pane.',
          queryPreview: queryText.substring(0, 160),
        });
      } catch (e) {
        return safeJSONStringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
  });

export function getTools(
  onAskPermission: (name: string, toolCallId: string, params: unknown) => Promise<boolean>,
  outputMode?: 'chat' | 'code',
  context?: { lastUserText?: string },
): ToolSet {
  console.log('[getTools] ========================================');
  console.log('[getTools] Output mode:', outputMode);
  console.log('[getTools] ========================================');

  const lastUserText = String(context?.lastUserText || '').toLowerCase();
  // Heuristic: only include token-heavy tool families when the user's message suggests they need them.
  const wantsPlan = /(execution\s+plan|show\s*plan|actual\s+plan|estimated\s+plan|query\s+plan|plan\s+xml|plan\s+cache)/i.test(lastUserText);
  const wantsStats = /(statistics\s+io|statistics\s+time|io\s+stats|time\s+stats|messages\s+tab|print\s+messages)/i.test(lastUserText);
  const wantsSchema = /(schema|columns?|data\s+type|index(es)?|constraint(s)?|ddl|create\s+table|table\s+definition)/i.test(lastUserText);
  const wantsInvestigation = /(blocking|deadlock|slow|performance|tune|optimi[sz]e|diagnos(e|is)|waits?|cpu|io|latency|dm_exec|sp_whoisactive|sp_blitz)/i.test(lastUserText);
  const wantsQueryBuilder = /(build\s+query|step\s*by\s*step|query\s+builder|add\s+where|select\s+columns)/i.test(lastUserText);
  
  // Always keep a minimal core toolset.
  // NOTE: Reducing tools materially reduces token usage because tool schemas/descriptions are sent to the model.
  const toolSet: ToolSet = {
    get_active_database,
    get_query_text,
    get_tab_list,
    switch_database,
    get_query_results,
    validate_query,
    conversion_rules,
  };

  // Include schema discovery tools only when needed.
  if (wantsSchema || wantsInvestigation || wantsQueryBuilder) {
    toolSet.get_tables = get_tables;
    toolSet.get_columns = get_columns;
    toolSet.get_db_objects = get_db_objects;
  }
  
  // In Chat mode, exclude tools that modify the query tab
  // In Code mode, include all tools
  if (outputMode !== 'chat') {
    console.log('[getTools] ✅ CODE MODE: Including insert_sql, run_current_query, etc.');
    toolSet.insert_sql = insert_sql;
    toolSet.open_new_tab = open_new_tab;
    toolSet.complete_query = complete_query;
    toolSet.insert_text_at_cursor = insert_text_at_cursor;
    toolSet.switch_to_tab = switch_to_tab;
    toolSet.close_current_tab = close_current_tab;
    // get_query_text and get_query_results are available again in Code Mode.
  } else {
    console.log('[getTools] 💬 CHAT MODE: Excluding insert_sql, run_current_query, etc.');
    // Close tab is safe in both modes
    (toolSet as any).close_current_tab = close_current_tab;
  }
  // Expose execution tools based on mode
  if (outputMode === 'chat') {
    // Chat mode: allow run_query (prompts Yes/No in chat), disallow run_current_query
    console.log('[getTools] 💬 CHAT MODE: Adding run_query tool');
    toolSet["run_query"] = run_query(async (toolCallId, params) => {
      const permitted = await onAskPermission("run_query", toolCallId, params);
      return permitted;
    });
    console.log('[getTools] 💬 CHAT MODE: run_query tool added, run_current_query NOT available');

    // Chat mode: always expose run_diagnostic_query.
    // We previously gated it behind heuristics to reduce schema/tool overhead, but this caused:
    // - The assistant deciding to run diagnostics, while the tool was missing.
    // - UI showing "Run Diagnostic Query" inconsistently.
    console.log('[getTools] 💬 CHAT MODE: Adding run_diagnostic_query tool');
    toolSet["run_diagnostic_query"] = run_diagnostic_query;
    console.log('[getTools] 💬 CHAT MODE: run_diagnostic_query tool added for safe system diagnostics');

    // IMPORTANT: Always expose system schema fetch tool in Chat mode.
    // Schema-first enforcement and validation error recovery can require this tool even when the
    // user's prompt does not match our "investigation" heuristics (e.g., memory clerk/DMV questions).
    // If this tool is missing, the model will fail with AI_NoSuchToolError.
    toolSet["get_system_object_schema"] = get_system_object_schema_cached;

    // Metadata tool is only needed when the user asks about schema/indexes.
    if (wantsSchema || wantsInvestigation) {
      console.log('[getTools] 💬 CHAT MODE: Adding get_user_table_schema tool');
      toolSet["get_user_table_schema"] = get_user_table_schema;
      console.log('[getTools] 💬 CHAT MODE: get_user_table_schema tool added for safe metadata fetching');
    }

    // Dynamic investigation tools are token-heavy; include only for investigation-like asks.
    if (wantsInvestigation) {
      console.log('[getTools] 💬 CHAT MODE: Adding dynamic investigation tools');
      toolSet["analyze_investigation_question"] = analyze_investigation_question;
      toolSet["generate_investigation_query"] = generate_investigation_query;
      toolSet["analyze_investigation_results"] = analyze_investigation_results;
      console.log('[getTools] 💬 CHAT MODE: Dynamic investigation tools added (provide_investigation_recommendations REMOVED)');
    }

    // Query builder tools only when explicitly asked.
    if (wantsQueryBuilder) {
      console.log('[getTools] 💬 CHAT MODE: Adding query builder tools');
      toolSet["query_builder_select_object"] = query_builder_select_object;
      toolSet["query_builder_select_columns"] = query_builder_select_columns;
      toolSet["query_builder_add_where"] = query_builder_add_where;
      toolSet["query_builder_build"] = query_builder_build;
      console.log('[getTools] 💬 CHAT MODE: Query builder tools added for step-by-step query construction');
    }

    // Execution/IO plan-related tools only when requested.
    if (wantsPlan) {
      console.log('[getTools] 💬 CHAT MODE: Adding get_execution_plan tool');
      toolSet["get_execution_plan"] = get_execution_plan;
    }
    if (wantsStats) {
      console.log('[getTools] 💬 CHAT MODE: Adding statistics/messages tools');
      toolSet["get_statistics"] = get_statistics;
      toolSet["get_messages"] = get_messages;
    }
  } else {
    // Code mode: allow run_current_query (executes in editor tab), disallow run_query
    console.log('[getTools] ✅ CODE MODE: Adding run_current_query tool');
    console.log('[getTools] 🚫 CODE MODE: run_query tool is BLOCKED and will NOT be added');
    toolSet["run_current_query"] = run_current_query(async (toolCallId, params) => {
      const permitted = await onAskPermission("run_current_query", toolCallId, params);
      return permitted;
    });
    
    // CRITICAL: Explicitly ensure run_query is NOT in the toolset for Code Mode
    if ('run_query' in toolSet) {
      console.error('[getTools] ❌ CRITICAL ERROR: run_query found in Code Mode toolset! Removing it now.');
      delete (toolSet as any)['run_query'];
    }
  }
  
  console.log('[getTools] Available tools:', Object.keys(toolSet).join(', '));
  console.log('[getTools] ========================================');
  return toolSet;
}

export class UserRejectedError extends Error {
  constructor(public toolCallId: string) {
    super(`User rejected tool call. (toolCallId: ${toolCallId})`);
    this.name = "UserRejectedError";
  }

  static isInstance(error: any): error is UserRejectedError {
    return error && error.name === "UserRejectedError";
  }
}

// ============================================================================
// COMMAND PROMPT BUILDER: Build specialized prompts for slash commands
// ============================================================================
export function buildCommandPrompt(command: string, database: string | null, mentions: any[], tables: any[], userPrompt: string = '', systemObjectSchemas: Record<string, any> | null = null, mentionedObjectsWithTypes: Array<{schema: string, name: string, type: string}> | null = null): string {
  const cmd = command.toLowerCase().replace(/^\//, '');
  const db = database || 'YourDatabase';
  
  // Extract mentioned objects - mentions are strings like 'HumanResources.Department'
  const mentionedTables = mentions.map((m: any) => {
    if (typeof m === 'string') {
      const parts = m.split('.');
      if (parts.length === 2) {
        return { schema: parts[0], name: parts[1] };
      }
    } else if (m.schema && m.name) {
      return { schema: m.schema, name: m.name };
    }
    return null;
  }).filter(Boolean);
  
  const mentionedObjects = mentions.map((m: any) => typeof m === 'string' ? m : `${m.schema}.${m.name}`).join(', ');
  
  // Detect object types for intelligent parameter selection
  let mentionedProcedures: string[] = [];
  let mentionedTablesOrViews: string[] = [];
  
  try { console.log('[buildCommandPrompt] mentionedObjectsWithTypes:', mentionedObjectsWithTypes); } catch {}
  
  if (mentionedObjectsWithTypes && mentionedObjectsWithTypes.length > 0) {
    mentionedProcedures = mentionedObjectsWithTypes
      .filter(obj => obj.type === 'procedure')
      .map(obj => `${obj.schema}.${obj.name}`);
    
    mentionedTablesOrViews = mentionedObjectsWithTypes
      .filter(obj => obj.type === 'table' || obj.type === 'view')
      .map(obj => `${obj.schema}.${obj.name}`);
    
    try { console.log('[buildCommandPrompt] Detected procedures:', mentionedProcedures); } catch {}
    try { console.log('[buildCommandPrompt] Detected tables/views:', mentionedTablesOrViews); } catch {}
  }
  
  // Build system object schema section if available
  let systemSchemaSection = '';
  if (systemObjectSchemas && Object.keys(systemObjectSchemas).length > 0) {
    systemSchemaSection = '\n\n📋 SYSTEM OBJECT SCHEMAS (Use these exact names):\n';
    for (const [objName, schema] of Object.entries(systemObjectSchemas)) {
      systemSchemaSection += `\n${objName}:\n`;
      
      // Handle system views/DMVs (have columns)
      if (schema.columns && schema.columns.length > 0) {
        systemSchemaSection += '  Columns:\n';
        systemSchemaSection += schema.columns.map((col: any) => 
          `    - ${col.name} (${col.type}${col.maxLength > 0 && col.maxLength !== -1 ? `(${col.maxLength})` : ''}${col.nullable ? ', nullable' : ', NOT NULL'})`
        ).join('\n');
        systemSchemaSection += '\n';
      }
      
      // Handle stored procedures (have parameters)
      if (schema.type === 'procedure' && schema.parameters && schema.parameters.length > 0) {
        systemSchemaSection += '  Parameters:\n';
        systemSchemaSection += schema.parameters.map((param: any) => 
          `    - ${param.name} (${param.type}${param.maxLength > 0 && param.maxLength !== -1 ? `(${param.maxLength})` : ''}${param.isOutput ? ', OUTPUT' : ''})`
        ).join('\n');
        systemSchemaSection += '\n';
      }
    }
  }
  
  // sp_WhoIsActive commands
  if (cmd === 'sp-whoisactive') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_WhoIsActive for real-time monitoring.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. CAREFULLY READ the user's request: "${userPrompt}"
2. EXTRACT specific requirements:
   - If they mention "blocking", add @find_block_leaders = 1, @get_locks = 1
   - If they mention "locks", add @get_locks = 1
   - If they mention "plans" or "execution plans", add @get_plans = 1
   - If they mention "delta" or a time interval (e.g., "5 seconds"), add @delta_interval = N
   - If they mention "tempdb", add tempdb columns to @output_column_list
   - If they mention "memory", add @get_memory_info = 1
   - If they mention "transaction" or "tran", add @get_transaction_info = 1
   - If they mention "sleeping", add @show_sleeping_spids = 1
   - If they mention a database name, add @filter = 'DatabaseName', @filter_type = 'database'
3. Generate ONLY the T-SQL that matches their EXACT request

COMMON PARAMETERS:
@filter - Filter by database, login, host, program, or session_id
@filter_type - Type of filter: session, program, database, login, host
@not_filter - Exclude sessions matching filter
@show_own_spid - Show the session running sp_WhoIsActive (default 0)
@show_system_spids - Show system sessions (default 0)
@show_sleeping_spids - Show sleeping sessions (default 1)
@get_full_inner_text - Get full SQL text instead of outer (default 0)
@get_plans - Get execution plans (default 0)
@get_outer_command - Get outer command text (default 0)
@get_transaction_info - Get transaction details (default 0)
@get_task_info - Get task information (default 1)
@get_locks - Get lock information (default 0)
@get_avg_time - Get average task time (default 0)
@get_additional_info - Get additional session info (default 0)
@find_block_leaders - Find blocking chain leaders (default 0)
@delta_interval - Seconds between snapshots for delta mode (default 0)
@output_column_list - Customize output columns (default all)
@sort_order - Sort results (e.g., '[CPU] DESC', '[blocked_session_count] DESC')
@format_output - Format for readability (default 1)
@destination_table - Save results to table
@return_schema - Return schema only (default 0)
@help - Show help (default 0)

EXAMPLE USAGE:

-- Basic monitoring
EXEC sp_WhoIsActive;

-- Filter by database
EXEC sp_WhoIsActive 
  @filter = '${db}',
  @filter_type = 'database';

-- Show blocking with locks
EXEC sp_WhoIsActive 
  @find_block_leaders = 1,
  @get_locks = 1,
  @sort_order = '[blocked_session_count] DESC';

-- Get execution plans
EXEC sp_WhoIsActive 
  @get_plans = 1,
  @get_full_inner_text = 1;

-- Delta mode (5 second snapshot)
EXEC sp_WhoIsActive 
  @delta_interval = 5,
  @output_column_list = '[dd%][session_id][%delta][sql_text][%]';

Generate a comprehensive script with comments explaining parameters and output.`;
  }
  
  if (cmd === 'sp-whoisactive-delta') {
    return `Generate a T-SQL script to run sp_WhoIsActive with delta analysis (5 second interval).

EXEC sp_WhoIsActive
  @output_column_list = '[dd%][session_id][%delta][login_name][sql_text][%]',
  @delta_interval = 5;

Include comments explaining delta columns and their meaning.`;
  }
  
  if (cmd === 'sp-whoisactive-tran') {
    return `Generate a T-SQL script to run sp_WhoIsActive with transaction log usage.

EXEC sp_WhoIsActive
  @output_column_list = '[dd%][session_id][tran%][login_name][sql_text][%]',
  @get_transaction_info = 1;

Include comments explaining transaction columns.`;
  }
  
  if (cmd === 'sp-whoisactive-memory') {
    return `Generate a T-SQL script to run sp_WhoIsActive with memory usage.

EXEC sp_WhoIsActive
  @output_column_list = '[dd%][session_id][%memory%][login_name][sql_text][%]',
  @get_memory_info = 1;

Include comments explaining memory columns.`;
  }
  
  if (cmd === 'sp-whoisactive-tempdb') {
    return `Generate a T-SQL script to run sp_WhoIsActive with tempdb usage, sorted by tempdb consumption.

EXEC sp_WhoIsActive
  @output_column_list = '[start_time][session_id][temp%][sql_text][query_plan][wait_info][%]',
  @get_plans = 1,
  @sort_order = '[tempdb_current] DESC';

Include comments explaining tempdb columns.`;
  }
  
  if (cmd === 'sp-whoisactive-blocking') {
    return `Generate a T-SQL script to run sp_WhoIsActive with blocking analysis.

EXEC sp_WhoIsActive
  @output_column_list = '[start_time][session_id][block%][login%][locks][sql_text][%]',
  @find_block_leaders = 1,
  @get_locks = 1,
  @get_additional_info = 1,
  @sort_order = '[blocked_session_count] DESC';

Include comments explaining blocking columns and how to identify head blockers.`;
  }
  
  if (cmd === 'sp-whoisactive-plans') {
    return `Generate a T-SQL script to run sp_WhoIsActive with execution plans.

EXEC sp_WhoIsActive
  @get_plans = 1,
  @get_full_inner_text = 1;

Include comments explaining how to view the plans.`;
  }
  
  // sp_Blitz commands
  if (cmd === 'sp-blitzindex') {
    if (mentionedTables.length > 0) {
      // Generate the exact script with comments
      const fullScript = mentionedTables.map((t: any) => `-- Analyze indexes for ${t.schema}.${t.name}
EXEC sp_BlitzIndex 
  @DatabaseName = '${db}',
  @SchemaName = '${t.schema}',
  @TableName = '${t.name}';`).join('\n\n');
      
      const explanation = `
/*
ANALYZING TABLE: ${mentionedObjects}

sp_BlitzIndex automatically provides detailed diagnosis when @TableName is specified.
⚠️ IMPORTANT: @Mode parameter is NOT allowed with @TableName and will cause an error.

INTERPRETING RESULTS:
- Priority: Issue severity (1=Critical, 50=Warning, 200=Info)
- findings: Description of the issue (e.g., "Missing Index", "Unused Index")
- index_action: Recommended action (CREATE, DROP, DISABLE, REBUILD)
- index_definition: Ready-to-run T-SQL script
- URL: Link to detailed explanation

COMMON ISSUES:
1. Missing Indexes: Queries would benefit from new indexes
2. Unused Indexes: Indexes with zero reads (candidates for removal)
3. Duplicate Indexes: Multiple indexes covering the same columns
4. Fragmentation: Indexes needing rebuild/reorganize
5. Heaps: Tables without clustered indexes

NEXT STEPS:
- Review Priority 1-50 findings first
- Check 'index_definition' column for ready-to-run scripts
- Test recommendations in a non-production environment first
*/`;
      
      // Return the complete script directly - no AI interpretation needed
      return fullScript + explanation;
    }
    
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_BlitzIndex for database: ${db}

User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. If they mention a specific MODE number, use that @Mode parameter
3. If they mention "detailed" or "diagnosis", use @Mode = 4
4. If they mention "summary", use @Mode = 0
5. Generate the T-SQL matching their request

AVAILABLE MODES:
@Mode = 0 - Prioritized list of issues (default)
@Mode = 1 - Summarize database indexes
@Mode = 2 - Index usage details
@Mode = 3 - Missing indexes
@Mode = 4 - Detailed diagnosis

GENERATE THIS SCRIPT:

-- Check if sp_BlitzIndex exists
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'sp_BlitzIndex')
BEGIN
    PRINT 'sp_BlitzIndex not found. Install from: https://github.com/BrentOzarULTD/SQL-Server-First-Responder-Kit'
END
ELSE
BEGIN
    -- Mode 0: Prioritized list of issues
    EXEC sp_BlitzIndex 
        @DatabaseName = '${db}',
        @Mode = 0;
    
    -- Mode 4: Detailed diagnosis
    EXEC sp_BlitzIndex 
        @DatabaseName = '${db}',
        @Mode = 4;
END

Include comments explaining modes and how to interpret results.`;
  }
  
  if (cmd === 'sp-blitz') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_Blitz health check.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention "procedure cache", add @CheckProcedureCache = 1
   - If they mention "user databases" or "database objects", add @CheckUserDatabaseObjects = 1
   - If they mention "expensive" or "deep", add @BringThePain = 1
   - If they mention "critical" or priority number, add @IgnorePrioritiesAbove = N
   - If they mention "save" or "table", add @OutputDatabaseName and @OutputTableName
3. Generate the T-SQL matching their request

COMMON PARAMETERS:
@CheckUserDatabaseObjects - Check for issues in user databases (default 1)
@CheckProcedureCache - Check procedure cache for issues (default 0)
@OutputType - Output format: TABLE, COUNT, MARKDOWN, NONE (default TABLE)
@OutputProcedureCache - Output procedure cache results (default 0)
@CheckProcedureCacheFilter - Filter procedure cache (default NULL)
@CheckServerInfo - Check server configuration (default 0)
@SkipChecksServer - Skip specific server checks (comma-separated)
@SkipChecksDatabase - Skip specific database checks (comma-separated)
@IgnorePrioritiesAbove - Ignore findings above this priority (default NULL)
@IgnorePrioritiesBelow - Ignore findings below this priority (default NULL)
@OutputDatabaseName - Database to store results (default NULL)
@OutputSchemaName - Schema for output table (default dbo)
@OutputTableName - Table name for results (default NULL)
@OutputXMLasNVARCHAR - Output XML as NVARCHAR (default 0)
@SummaryMode - Show summary only (default 0)
@BringThePain - Run expensive checks (default 0)
@Help - Show help (default 0)
@Version - Show version (default 0)
@VersionDate - Show version date (default 0)
@VersionCheckMode - Check for updates (default 0)

EXAMPLE USAGE:

-- Basic health check
EXEC sp_Blitz;

-- Check user database objects
EXEC sp_Blitz 
  @CheckUserDatabaseObjects = 1;

-- Check procedure cache for issues
EXEC sp_Blitz 
  @CheckProcedureCache = 1,
  @BringThePain = 1;

-- Filter by priority (only critical issues)
EXEC sp_Blitz 
  @IgnorePrioritiesAbove = 50;

-- Save results to table
EXEC sp_Blitz 
  @OutputDatabaseName = '${db}',
  @OutputSchemaName = 'dbo',
  @OutputTableName = 'BlitzResults';

Generate a comprehensive script with comments explaining priority levels and findings.`;
  }
  
  if (cmd === 'sp-blitzfirst') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_BlitzFirst for current performance analysis.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention a NUMBER of seconds (e.g., "30 seconds", "60 second"), use @Seconds = N
   - If they mention "expert mode" or "detailed", add @ExpertMode = 1
   - If they mention "procedure cache" or "plan cache", add @CheckProcedureCache = 1
   - If they mention "since startup", add @SinceStartup = 1
   - If they mention "save" or "table", add @OutputDatabaseName and @OutputTableName
3. Generate the T-SQL matching their request

COMMON PARAMETERS:
@Seconds - Seconds to wait between first and second check (default 5)
@ExpertMode - Show detailed metrics (default 0)
@OutputType - Output format: TABLE, COUNT, MARKDOWN (default TABLE)
@OutputDatabaseName - Database to store results
@OutputSchemaName - Schema for output table (default dbo)
@OutputTableName - Table name for results
@OutputTableNameFileStats - Table for file stats
@OutputTableNamePerfmonStats - Table for perfmon stats
@OutputTableNameWaitStats - Table for wait stats
@OutputTableNameBlocking - Table for blocking
@CheckProcedureCache - Check procedure cache (default 0)
@FileLatencyThresholdMS - File latency threshold in ms (default 100)
@SinceStartup - Show stats since SQL Server startup (default 0)
@ShowSleepingSPIDs - Show sleeping sessions (default 0)
@Help - Show help (default 0)
@AsOf - Show historical data from output tables
@Debug - Debug mode (default 0)

EXAMPLE USAGE:

-- Basic 5-second snapshot
EXEC sp_BlitzFirst;

-- 30-second detailed analysis
EXEC sp_BlitzFirst 
  @Seconds = 30,
  @ExpertMode = 1;

-- Check procedure cache
EXEC sp_BlitzFirst 
  @Seconds = 10,
  @CheckProcedureCache = 1;

-- Show stats since startup
EXEC sp_BlitzFirst 
  @SinceStartup = 1;

-- Save results to table
EXEC sp_BlitzFirst 
  @Seconds = 5,
  @OutputDatabaseName = '${db}',
  @OutputSchemaName = 'dbo',
  @OutputTableName = 'BlitzFirstResults';

Generate a comprehensive script with comments explaining real-time performance metrics.`;
  }
  
  if (cmd === 'sp-blitzcache') {
    // Build intelligent parameter hints based on mentioned objects
    let objectTypeHint = '';
    if (mentionedProcedures.length > 0) {
      objectTypeHint = `\n\n🎯 DETECTED STORED PROCEDURE: ${mentionedProcedures.join(', ')}
Use @StoredProcName parameter for stored procedures (NOT @QueryFilter)
Example: EXEC sp_BlitzCache @StoredProcName = '${mentionedProcedures[0]}';`;
    } else if (mentionedTablesOrViews.length > 0) {
      objectTypeHint = `\n\n🎯 DETECTED TABLE/VIEW: ${mentionedTablesOrViews.join(', ')}
Use @QueryFilter parameter for tables/views (finds queries that reference them)
Example: EXEC sp_BlitzCache @QueryFilter = '${mentionedTablesOrViews[0]}';`;
    }
    
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_BlitzCache for plan cache analysis.

Database: ${db}
User Request: "${userPrompt}"
${objectTypeHint}

⚠️ CRITICAL INSTRUCTIONS - READ THE USER'S EXACT WORDS ⚠️
Analyze this request word-by-word: "${userPrompt}"

PARAMETER EXTRACTION RULES:
1. NUMBER EXTRACTION:
   - "top 10" → @Top = 10
   - "top 20" → @Top = 20
   - "top 50" → @Top = 50
   - If NO number mentioned, do NOT add @Top (use default)

2. SORT ORDER EXTRACTION:
   - "CPU" → @SortOrder = 'CPU'
   - "reads" OR "logical reads" → @SortOrder = 'reads'
   - "writes" → @SortOrder = 'writes'
   - "duration" OR "slow" → @SortOrder = 'duration'
   - "executions" OR "execution count" → @SortOrder = 'executions'
   - "memory" OR "memory grant" → @SortOrder = 'memory grant'
   - "spills" OR "tempdb spills" → @SortOrder = 'spills'
   - "recent compilations" → @SortOrder = 'recent compilations'

3. DETAIL LEVEL EXTRACTION:
   - "expert mode" OR "detailed" OR "expert" → @ExpertMode = 1
   - "without summary" OR "no summary" OR "hide summary" → @HideSummary = 1
   - "skip analysis" OR "no analysis" OR "raw data" → @SkipAnalysis = 1
   - "with plans" OR "show plans" OR "execution plans" → @GetAllDatabaseData = 1
   - "warnings only" → @OnlyQueryHashes = NULL, @IgnoreSystemDBs = 1

4. FILTER EXTRACTION:
   - If they mention a TABLE name → @QueryFilter = 'TableName'
   - If they mention a specific DATABASE → @DatabaseName = 'DatabaseName'
   - If they mention duration threshold (e.g., "longer than 5 seconds") → @DurationFilter = 5

5. SPECIAL MODIFIERS:
   - "without summary" → Add @HideSummary = 1 (hides the summary/findings section)
   - "skip analysis" → Add @SkipAnalysis = 1 (skips warnings/analysis, shows raw data only)
   - "only warnings" → Add @OnlyQueryHashes = NULL
   - "include system databases" → Do NOT add @IgnoreSystemDBs

AVAILABLE PARAMETERS (use ONLY what the user requests):
@Top - Number of queries to return
@SortOrder - Sort by: 'reads', 'CPU', 'executions', 'duration', 'memory grant', 'spills', 'writes', 'recent compilations'
@ExpertMode - Show additional columns (1 = yes, 0 = no)
@HideSummary - Hide summary/findings section (1 = hide, 0 = show)
@SkipAnalysis - Skip analysis/warnings, show raw data only (1 = skip, 0 = analyze)
@DatabaseName - Filter by specific database
@QueryFilter - Filter queries containing specific text/table
@DurationFilter - Minimum duration in seconds
@GetAllDatabaseData - Get data from all databases (1 = yes)
@IgnoreSystemDBs - Ignore system databases (1 = yes, 0 = no)
@OnlyQueryHashes - Specific query hashes to analyze
@OutputDatabaseName - Save results to database
@OutputSchemaName - Schema for output table
@OutputTableName - Table name for results

EXAMPLE MAPPINGS (STUDY THESE CAREFULLY):
"top 20 CPU consuming queries" → EXEC sp_BlitzCache @Top = 20, @SortOrder = 'CPU';
"top 10 logical reads without summary" → EXEC sp_BlitzCache @Top = 10, @SortOrder = 'reads', @HideSummary = 1;
"top 50 by reads" → EXEC sp_BlitzCache @Top = 50, @SortOrder = 'reads';
"queries with memory grants in expert mode" → EXEC sp_BlitzCache @SortOrder = 'memory grant', @ExpertMode = 1;
"top 10 slow queries" → EXEC sp_BlitzCache @Top = 10, @SortOrder = 'duration';
"CPU queries without summary" → EXEC sp_BlitzCache @SortOrder = 'CPU', @HideSummary = 1;
"top 5 reads skip analysis" → EXEC sp_BlitzCache @Top = 5, @SortOrder = 'reads', @SkipAnalysis = 1;
"raw data for CPU queries" → EXEC sp_BlitzCache @SortOrder = 'CPU', @SkipAnalysis = 1;
"show me execution plans for top 5 reads" → EXEC sp_BlitzCache @Top = 5, @SortOrder = 'reads', @GetAllDatabaseData = 1;

⚠️ IMPORTANT RULES:
- Do NOT hardcode values that the user didn't specify
- Do NOT add @Top if user didn't mention a number
- Do NOT add parameters the user didn't request
- ONLY generate parameters that match the user's EXACT words
- If user says "without summary", you MUST add @HideSummary = 1
- If user says "skip analysis" or "raw data", you MUST add @SkipAnalysis = 1

NOW ANALYZE THIS REQUEST AND GENERATE THE EXACT SCRIPT:
"${userPrompt}"

Think step by step:
1. What NUMBER did they mention? (if any)
2. What SORT ORDER did they mention? (CPU, reads, duration, etc.)
3. Did they say "without summary" or "no summary"? (if yes, add @HideSummary = 1)
4. Did they say "skip analysis" or "raw data"? (if yes, add @SkipAnalysis = 1)
5. Did they say "expert mode" or "detailed"? (if yes, add @ExpertMode = 1)
6. Any other specific requirements?

Generate ONLY the parameters that match their request.`;
  }
  
  if (cmd === 'sp-blitzlock') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_BlitzLock for deadlock analysis.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention a NUMBER (e.g., "top 20"), use @Top = N
   - If they mention a TABLE name, use @ObjectName = 'TableName'
   - If they mention a DATE or time period, use @StartDate and @EndDate
   - If they mention an APPLICATION, use @AppName = 'AppName'
   - If they mention a LOGIN, use @LoginName = 'LoginName'
3. Generate the T-SQL matching their request

AVAILABLE PARAMETERS:
@Top - Number of deadlocks to return (default 10)
@DatabaseName - Filter by database name
@StartDate - Start date for deadlock search (format: 'YYYY-MM-DD')
@EndDate - End date for deadlock search (format: 'YYYY-MM-DD')
@ObjectName - Filter by object name (table, view, etc.)
@StoredProcName - Filter by stored procedure name
@AppName - Filter by application name
@HostName - Filter by host name
@LoginName - Filter by login name
@EventSessionPath - Path to Extended Events session files

EXAMPLE MAPPING:
User says: "show deadlocks on Orders table" → EXEC sp_BlitzLock @ObjectName = 'Orders';
User says: "top 20 deadlocks" → EXEC sp_BlitzLock @Top = 20;
User says: "deadlocks last week" → EXEC sp_BlitzLock @StartDate = '2024-11-07', @EndDate = '2024-11-14';

NOW GENERATE THE SCRIPT BASED ON: "${userPrompt}"`;
  }
  
  if (cmd === 'sp-blitzwho') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run sp_BlitzWho for active session analysis.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention "sleeping" or "all sessions", use @ShowSleepingSPIDs = 1
   - If they mention "expert" or "detailed", use @ExpertMode = 1
3. Generate the T-SQL matching their request

AVAILABLE PARAMETERS:
@ShowSleepingSPIDs - Show sleeping sessions (0 or 1, default 0)
@ExpertMode - Show additional details (0 or 1, default 0)

EXAMPLE MAPPING:
User says: "show all sessions including sleeping" → EXEC sp_BlitzWho @ShowSleepingSPIDs = 1;
User says: "expert mode" → EXEC sp_BlitzWho @ExpertMode = 1;
User says: "detailed analysis with sleeping sessions" → EXEC sp_BlitzWho @ShowSleepingSPIDs = 1, @ExpertMode = 1;

NOW GENERATE THE SCRIPT BASED ON: "${userPrompt}"`;
  }
  
  // Ola Hallengren commands
  if (cmd === 'ola-backup') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run Ola Hallengren's DatabaseBackup procedure.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention "FULL" backup, use @BackupType = 'FULL'
   - If they mention "DIFFERENTIAL" or "DIFF", use @BackupType = 'DIFF'
   - If they mention "LOG" or "transaction log", use @BackupType = 'LOG'
   - If they mention a specific database, use @Databases = 'DatabaseName'
   - If they mention "all databases" or "user databases", use @Databases = 'USER_DATABASES'
   - If they mention "system databases", use @Databases = 'SYSTEM_DATABASES'
3. Generate the T-SQL matching their request

AVAILABLE PARAMETERS:
@Databases - Databases to backup: 'USER_DATABASES', 'SYSTEM_DATABASES', 'ALL_DATABASES', or specific database name
@Directory - Backup directory path (required)
@BackupType - Backup type: 'FULL', 'DIFF', 'LOG'
@Verify - Verify backup: 'Y' or 'N' (default N)
@Compress - Compress backup: 'Y' or 'N' (default N)
@CheckSum - Add checksum: 'Y' or 'N' (default N)
@CleanupTime - Delete old backups older than N hours
@CleanupMode - Cleanup mode: 'BEFORE_BACKUP' or 'AFTER_BACKUP'

EXAMPLE MAPPING:
User says: "full backup of all user databases" → @Databases = 'USER_DATABASES', @BackupType = 'FULL'
User says: "transaction log backup" → @BackupType = 'LOG'
User says: "differential backup with compression" → @BackupType = 'DIFF', @Compress = 'Y'

NOW GENERATE THE SCRIPT BASED ON: "${userPrompt}"`;
  }
  
  if (cmd === 'ola-integrity') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run Ola Hallengren's DatabaseIntegrityCheck.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention "CHECKDB", use @CheckCommands = 'CHECKDB'
   - If they mention "CHECKTABLE", use @CheckCommands = 'CHECKTABLE'
   - If they mention "CHECKALLOC", use @CheckCommands = 'CHECKALLOC'
   - If they mention "CHECKCATALOG", use @CheckCommands = 'CHECKCATALOG'
   - If they mention "physical only", add @PhysicalOnly = 'Y'
3. Generate the T-SQL matching their request

AVAILABLE PARAMETERS:
@Databases - Databases to check: 'USER_DATABASES', 'SYSTEM_DATABASES', 'ALL_DATABASES', or specific database
@CheckCommands - Commands: 'CHECKDB', 'CHECKALLOC', 'CHECKCATALOG', 'CHECKTABLE', 'CHECKFILEGROUP'
@PhysicalOnly - Physical checks only: 'Y' or 'N' (faster but less thorough)
@NoIndex - Skip index checks: 'Y' or 'N'
@ExtendedLogicalChecks - Extended logical checks: 'Y' or 'N' (slower but more thorough)

EXAMPLE MAPPING:
User says: "check database integrity" → @CheckCommands = 'CHECKDB'
User says: "quick physical check" → @CheckCommands = 'CHECKDB', @PhysicalOnly = 'Y'

NOW GENERATE THE SCRIPT BASED ON: "${userPrompt}"`;
  }
  
  if (cmd === 'ola-index') {
    return `You are an expert SQL Server DBA. Generate a T-SQL script to run Ola Hallengren's IndexOptimize.

Database: ${db}
User Request: "${userPrompt}"

CRITICAL INSTRUCTIONS:
1. READ the user's request: "${userPrompt}"
2. EXTRACT requirements:
   - If they mention specific fragmentation thresholds, use those values
   - If they mention "reorganize", set @FragmentationMedium = 'INDEX_REORGANIZE'
   - If they mention "rebuild", set @FragmentationHigh = 'INDEX_REBUILD_ONLINE,INDEX_REBUILD_OFFLINE'
   - If they mention "update statistics", add @UpdateStatistics = 'ALL'
3. Generate the T-SQL matching their request

AVAILABLE PARAMETERS:
@Databases - Databases to optimize: 'USER_DATABASES', 'SYSTEM_DATABASES', 'ALL_DATABASES', or specific database
@FragmentationLow - Action for low fragmentation (NULL = no action)
@FragmentationMedium - Action for medium fragmentation: 'INDEX_REORGANIZE'
@FragmentationHigh - Action for high fragmentation: 'INDEX_REBUILD_ONLINE,INDEX_REBUILD_OFFLINE'
@FragmentationLevel1 - Low fragmentation threshold (default 5%)
@FragmentationLevel2 - High fragmentation threshold (default 30%)
@UpdateStatistics - Update statistics: 'ALL', 'INDEX', 'COLUMNS', or NULL
@OnlyModifiedStatistics - Only update modified statistics: 'Y' or 'N'
@SortInTempdb - Sort in tempdb: 'Y' or 'N'
@MaxDOP - Max degree of parallelism (0 = use server default)
@FillFactor - Fill factor percentage
@TimeLimit - Time limit in seconds

EXAMPLE MAPPING:
User says: "optimize indexes with standard thresholds" → Use default fragmentation levels
User says: "rebuild all indexes" → @FragmentationLow = 'INDEX_REBUILD_ONLINE,INDEX_REBUILD_OFFLINE'
User says: "reorganize fragmented indexes" → @FragmentationMedium = 'INDEX_REORGANIZE'

NOW GENERATE THE SCRIPT BASED ON: "${userPrompt}"`;
  }

  // Handle analyze-plan command
  if (command.includes('analyze-plan') || command.includes('analyze plan') || command.includes('execution plan')) {
    return `You are an expert SQL Server DBA. Generate a concise, production-ready T-SQL script to analyze execution plans.

Database: ${db}
${mentionedObjects ? `Mentioned objects: ${mentionedObjects}` : ''}
${systemSchemaSection}

CRITICAL INSTRUCTIONS:
1. Generate ONLY executable T-SQL queries - NO placeholders, NO examples with "Replace this..."
2. Use ONLY the columns listed in the SYSTEM OBJECT SCHEMAS section above
3. Focus on the ${db} database specifically
4. Include these key metrics:
   - Execution counts, CPU time, elapsed time
   - Logical/physical reads and writes
   - Plan warnings (spills, missing indexes, implicit conversions)
   - Row estimate accuracy (actual vs estimated)
5. Keep the script under 100 lines
6. Add brief comments explaining each section
7. Order results by total_worker_time DESC

Generate the complete, executable script now using the exact column names from the schemas provided.`;
  }
  
  // Default: return the original prompt
  return `You are an expert SQL Server DBA. Generate a production-ready T-SQL script for: ${command}

Database: ${db}
${mentionedObjects ? `Mentioned objects: ${mentionedObjects}` : ''}
${systemSchemaSection}

⚠️ CRITICAL INSTRUCTIONS:
1. If SYSTEM OBJECT SCHEMAS are provided above, use ONLY those exact column names
2. NEVER use columns that don't exist in the schemas provided
3. For XML columns (like sys.dm_os_ring_buffers.record), use .value() method to parse data
4. ALWAYS verify column names exist in the schema before using them
5. Generate production-ready, executable SQL with detailed comments

Provide executable T-SQL with detailed comments explaining the query and how to interpret results.`;
}

// ============================================================================
// TWO-PHASE AGENTIC WORKFLOW HELPERS
// ============================================================================

// Request system object schemas from CoreTabs
function requestSystemObjectSchemas(systemObjects: string[], requestId: string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      try { console.error('[bks-ai-shell] Timeout waiting for system object schemas'); } catch {}
      resolve({}); // Return empty object on timeout
    }, 10000); // 10 second timeout
    
    // Listen for schema response
    const handler = (ev: MessageEvent) => {
      const data: any = ev?.data || {};
      if (data.type === 'bks-ai/system-schemas-response' && data.requestId === requestId) {
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
        try { console.log('[bks-ai-shell] Received system object schemas:', data.schemas); } catch {}
        resolve(data.schemas || {});
      }
    };
    
    window.addEventListener('message', handler);
    
    // Send request to CoreTabs
    const message = {
      type: 'bks-ai/fetch-system-schemas',
      requestId,
      systemObjects
    };
    
    try { console.log('[bks-ai-shell] Sending schema request to CoreTabs:', message); } catch {}
    try { window.parent?.postMessage(message, '*'); } catch (e) { resolve({}); }
  });
}

// Build schema section for Phase 2 prompt
function buildSystemSchemaSection(schemasResponse: Record<string, any>): string {
  if (!schemasResponse || Object.keys(schemasResponse).length === 0) {
    return '';
  }
  
  let section = '\n\n📋 SYSTEM OBJECT SCHEMAS (Use these exact names):\n';
  
  // Group objects by type for better organization
  const tableValuedFunctions: string[] = [];
  const scalarFunctions: string[] = [];
  const views: string[] = [];
  const procedures: string[] = [];
  
  for (const [objName, schema] of Object.entries(schemasResponse)) {
    const objType = schema.objectType || 'view';
    
    section += `\n${objName} [${objType.toUpperCase().replace(/_/g, ' ')}]:\n`;
    
    if (Array.isArray((schema as any).parameters) && (schema as any).parameters.length > 0) {
      const params = (schema as any).parameters
        .map((p: any) => `${p.name}${p.isOutput ? ' OUTPUT' : ''} (${p.type})`)
        .join(', ');
      section += `Parameters: ${params}\n`;
      section += `⚠️ IMPORTANT: Call ${objName} with ONLY these parameters (do not add extra arguments).\n`;
    }
    
    // Add columns
    if (schema.columns && Array.isArray(schema.columns)) {
      const columnList = schema.columns.map((col: any) => col.name).join(', ');
      section += `Columns: ${columnList}\n`;
    }
    
    // Track table-valued functions for special instructions
    if (objType === 'table_valued_function' || objType === 'inline_table_valued_function') {
      tableValuedFunctions.push(objName);
    } else if (objType === 'scalar_function') {
      scalarFunctions.push(objName);
    } else if (objType === 'view') {
      views.push(objName);
    } else if (objType === 'stored_procedure') {
      procedures.push(objName);
    }
    
    // Handle objects with columns (views, tables, functions)
    if (schema.columns && schema.columns.length > 0) {
      section += '  Columns:\n';
      section += schema.columns.map((col: any) => 
        `    - ${col.name} (${col.type}${col.maxLength > 0 && col.maxLength !== -1 ? `(${col.maxLength})` : ''}${col.nullable ? ', nullable' : ', NOT NULL'})`
      ).join('\n');
      section += '\n';
    }
    
    // Handle stored procedures (have parameters)
    if (schema.objectType === 'stored_procedure' && schema.parameters && schema.parameters.length > 0) {
      section += '  Parameters:\n';
      section += schema.parameters.map((param: any) => 
        `    - ${param.name} (${param.type}${param.maxLength > 0 && param.maxLength !== -1 ? `(${param.maxLength})` : ''}${param.isOutput ? ', OUTPUT' : ''})`
      ).join('\n');
      section += '\n';
    }
  }
  
  // Add T-SQL usage instructions based on object types detected
  if (tableValuedFunctions.length > 0) {
    section += '\n⚠️ TABLE-VALUED FUNCTIONS DETECTED:\n';
    section += `The following are TABLE-VALUED FUNCTIONS: ${tableValuedFunctions.join(', ')}\n`;
    section += 'CRITICAL: Use CROSS APPLY or OUTER APPLY, NOT JOIN\n';
    section += 'CRITICAL: You CANNOT reference outer table columns in function parameters\n';
    section += 'Example: CROSS APPLY sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID(\'table\'), NULL, NULL, \'DETAILED\') AS ips\n';
    section += '         WHERE ips.index_id = i.index_id\n';
  }
  
  if (scalarFunctions.length > 0) {
    section += '\n⚠️ SCALAR FUNCTIONS DETECTED:\n';
    section += `The following are SCALAR FUNCTIONS: ${scalarFunctions.join(', ')}\n`;
    section += 'These return a single value and can be used in SELECT, WHERE, or other expressions\n';
  }
  
  if (procedures.length > 0) {
    section += '\n⚠️ STORED PROCEDURES DETECTED:\n';
    section += `The following are STORED PROCEDURES: ${procedures.join(', ')}\n`;
    section += 'Use EXEC or EXECUTE to call these procedures with the parameters listed above\n';
  }
  
  return section;
}

function sanitizeMssqlSql(input: string): string {
  let sql = String(input || '');
  if (!sql.trim()) return sql;

  try {
    sql = sql.replace(/\r\n/g, '\n');
  } catch (_) {}

  try {
    sql = sql.replace(/\bCREATE\s+OR\s+REPLACE\b/gi, 'CREATE OR ALTER');
  } catch (_) {}

  try {
    const alterIndexWithInclude = /^\s*ALTER\s+INDEX\s+(.+?)\s+ON\s+(.+?)\s*\(([^\)]*)\)\s*\n?\s*INCLUDE\s*\(([^\)]*)\)\s*\n?\s*WITH\s*\(([^\)]*DROP_EXISTING[^\)]*)\)\s*;?/im;
    const m = alterIndexWithInclude.exec(sql);
    if (m) {
      const indexName = (m[1] || '').trim();
      const tableName = (m[2] || '').trim();
      const keyCols = (m[3] || '').trim();
      const includeCols = (m[4] || '').trim();
      let withOpts = (m[5] || '').trim();
      if (/^(PK_|UQ_|AK_)/i.test(indexName)) {
        withOpts = withOpts.replace(/\s*,?\s*DROP_EXISTING\s*=\s*ON\s*,?/ig, ',');
        withOpts = withOpts.replace(/\(\s*,/g, '(').replace(/,\s*\)/g, ')');
        withOpts = withOpts.replace(/,{2,}/g, ',').replace(/\(\s*\)/g, '');
      }
      if (indexName && tableName && keyCols && includeCols) {
        sql = `CREATE NONCLUSTERED INDEX ${indexName}\nON ${tableName} (${keyCols})\nINCLUDE (${includeCols})`;
        if (withOpts && /\S/.test(withOpts)) {
          sql += `\nWITH (${withOpts});`;
        } else {
          sql += ';';
        }
      }
    }
  } catch (_) {}

  return sql;
}

// ============================================================================
// INLINE AI BRIDGE: Listen for inline code requests from CoreTabs
// ============================================================================
try {
  if (typeof window !== 'undefined' && !(window as any).__bks_inline_ai_bridge) {
    (window as any).__bks_inline_ai_bridge = true;
    window.addEventListener('message', async (ev: MessageEvent) => {
      const data: any = ev?.data || {};
      if (!data || data.type !== 'bks-ai/inline-code/request') return;
      const { requestId, prompt, runAfterInsert, context, aiMode, command, mentions } = data;
      try { console.log('[bks-ai-shell] received inline request', { requestId, hasPrompt: !!prompt, hasContext: !!context, aiMode: aiMode || 'developer', command, mentions }); } catch {}
      
      let sql = '';
      let shouldReplace = false;  // Default to false, will be calculated below
      let currentQuery: string | null = null; // Declare outside try block for logging access
      try {
        // Use schema context from CoreTabs (already fetched)
        const tables = context?.tables || [];
        const database = context?.database || null;
        currentQuery = context?.currentQuery || null;
        const currentResults = context?.currentResults || null;
        const allResults = context?.allResults || [];
        const queryError = context?.queryError || null;
        const objectDefinitions = context?.objectDefinitions || null; // CREATE statements for mentioned objects
        const systemObjectSchemas = context?.systemObjectSchemas || null; // System DMV/procedure schemas for slash commands
        const mentionedObjectsWithTypes = context?.mentionedObjectsWithTypes || null; // Object types for parameter selection
        
        try { console.log('[bks-ai-shell] mentionedObjectsWithTypes from context:', mentionedObjectsWithTypes); } catch {}
        
        try { console.log('[bks-ai-shell] Context from CoreTabs', { 
          database, 
          tableCount: tables.length, 
          tables: tables.slice(0, 5).map((t: any) => `${t.schema ? t.schema + '.' : ''}${t.name}`),
          hasCurrentQuery: !!currentQuery,
          hasCurrentResults: !!currentResults,
          resultRowCount: currentResults?.rowCount || 0,
          totalResultSets: allResults.length,
          hasError: !!queryError,
          errorMessage: queryError?.message || null,
          hasObjectDefinitions: !!objectDefinitions,
          objectDefinitionsCount: objectDefinitions ? Object.keys(objectDefinitions).length : 0,
          hasSystemObjectSchemas: !!systemObjectSchemas,
          systemObjectSchemasCount: systemObjectSchemas ? Object.keys(systemObjectSchemas).length : 0
        }); } catch {}
        
        // Check if this is a slash command
        const isSlashCommand = command && command.trim().length > 0;
        let commandPrompt = '';
        let bypassAI = false; // Flag to skip AI and return SQL directly
        let bypassThreePhase = false; // Flag to skip 3-phase workflow for sp_blitz/sp_whoisactive commands
        
        if (isSlashCommand) {
          try { console.log('[bks-ai-shell] Processing slash command:', command, 'with mentions:', mentions, 'user prompt:', prompt); } catch {}
          commandPrompt = buildCommandPrompt(command, database, mentions, tables, prompt, systemObjectSchemas, mentionedObjectsWithTypes);
          
          // Check if this is a sp_blitz* or sp_whoisactive* command that should bypass 3-phase workflow
          const cmd = command.toLowerCase().replace(/^\//, '');
          try { console.log('[bks-ai-shell] Command check:', { cmd, hasMentions: !!(mentions && mentions.length > 0), mentions }); } catch {}
          
          // Bypass AI for sp_blitz* and sp_whoisactive* commands - use stored procedures directly
          const isBlitzCommand = cmd.startsWith('sp-blitz') || cmd.startsWith('sp-whoisactive');
          
          if (isBlitzCommand) {
            try { console.log('[bks-ai-shell] ✅ Detected sp_blitz/sp_whoisactive command - will use stored procedure directly'); } catch {}
            // For sp-blitzindex with table mentions, use pre-generated script
            if (cmd === 'sp-blitzindex' && mentions && mentions.length > 0) {
              // Parse mention strings to extract schema and table name
              // mentions array contains strings like 'HumanResources.Department'
              const mentionedTables = mentions.map((m: any) => {
                if (typeof m === 'string') {
                  const parts = m.split('.');
                  if (parts.length === 2) {
                    return { schema: parts[0], name: parts[1] };
                  }
                }
                return null;
              }).filter(Boolean);
              
              try { console.log('[bks-ai-shell] sp-blitzindex with table mentions detected:', mentionedTables); } catch {}
              if (mentionedTables.length > 0) {
                bypassAI = true;
                sql = commandPrompt; // Use the pre-generated script directly
                try { console.log('[bks-ai-shell] ✅ BYPASSING AI - Using pre-generated script:', sql.substring(0, 200)); } catch {}
              }
            }
            // For all other sp_blitz* and sp_whoisactive* commands, bypass 3-phase workflow
            // They will use single-phase AI to generate the EXEC statement with proper parameters
            if (!bypassAI) {
              bypassThreePhase = true;
              try { console.log('[bks-ai-shell] ✅ Will bypass 3-phase workflow for', cmd); } catch {}
            }
          }
        }
        
        // Build instruction for LLM
        const tblLines = tables.map((t: any) => `- ${t.schema ? t.schema + '.' : ''}${t.name}`).join('\n');
        
        // Check if we have column information
        const hasColumns = tables.some((t: any) => Array.isArray(t.columns) && t.columns.length > 0);
        const colLines = hasColumns ? tables.map((t: any) => {
          const fullName = `${t.schema ? t.schema + '.' : ''}${t.name}`;
          const cols = Array.isArray(t.columns) ? t.columns.join(', ') : '';
          return cols ? `- ${fullName}: ${cols}` : '';
        }).filter(Boolean).join('\n') : '';
        
        // Add current query context if available
        const queryContext: string[] = [];
        if (currentQuery && currentQuery.trim()) {
          queryContext.push('');
          queryContext.push('Current Query in Editor:');
          queryContext.push('```sql');
          queryContext.push(currentQuery.trim());
          queryContext.push('```');
        }
        
        // Add results context if available
        if (allResults && allResults.length > 0) {
          queryContext.push('');
          queryContext.push(`Query Results (${allResults.length} result set${allResults.length > 1 ? 's' : ''}):`);
          allResults.forEach((result: any) => {
            queryContext.push('');
            queryContext.push(`Result ${result.resultNumber}:`);
            queryContext.push(`- Rows returned: ${result.rowCount}`);
            queryContext.push(`- Columns: ${result.columns.join(', ')}`);
            if (result.rowCount === 0) {
              queryContext.push('⚠️ This result set returned 0 rows');
            } else if (result.sampleRows && result.sampleRows.length > 0) {
              queryContext.push('- Sample data (first 5 rows):');
              queryContext.push(JSON.stringify(result.sampleRows, null, 2));
            }
          });
        } else if (currentResults && currentResults.rowCount > 0) {
          queryContext.push('');
          queryContext.push('Last Query Results:');
          queryContext.push(`- Rows returned: ${currentResults.rowCount}`);
          queryContext.push(`- Columns: ${currentResults.columns.join(', ')}`);
          if (currentResults.sampleRows && currentResults.sampleRows.length > 0) {
            queryContext.push('- Sample data (first 5 rows):');
            queryContext.push(JSON.stringify(currentResults.sampleRows, null, 2));
          }
        } else if (currentResults && currentResults.rowCount === 0) {
          queryContext.push('');
          queryContext.push('⚠️ Last Query Returned 0 Rows');
          queryContext.push('The query executed successfully but returned no results.');
        }
        
        // Add error context if available
        if (queryError) {
          queryContext.push('');
          queryContext.push('❌ QUERY ERROR DETECTED:');
          queryContext.push(`Error: ${queryError.message}`);
          if (queryError.code) queryContext.push(`Code: ${queryError.code}`);
          queryContext.push('');
          queryContext.push('TASK: Fix the Current Query above by:');
          queryContext.push('1. Finding which column/table name is invalid (check the error message)');
          queryContext.push('2. Looking up the correct table that has this column in "Available Columns" above');
          queryContext.push('3. If the column is in a different table than currently used, add a JOIN to that table');
          queryContext.push('4. Update the column reference to use the correct table alias');
          queryContext.push('5. Keep everything else in the query exactly the same');
          queryContext.push('');
          queryContext.push('OUTPUT FORMAT:');
          queryContext.push('-- [Comment explaining what was wrong]');
          queryContext.push('-- [Original broken query, every line commented with --]');
          queryContext.push('');
          queryContext.push('-- Fixed query:');
          queryContext.push('[The same query with only the error fixed]');
        }
        
        // Detect if user wants to modify/replace existing query
        const modifyKeywords = ['add', 'modify', 'change', 'update', 'optimize', 'improve', 'rewrite', 'fix', 'convert', 'refactor', 'simplify', 'comment'];
        const referenceKeywords = ['this query', 'the query', 'current query', 'above query', 'existing query', 'this error', 'the error'];
        const promptLower = (prompt || '').toLowerCase();
        shouldReplace = currentQuery && (
          referenceKeywords.some(kw => promptLower.includes(kw)) ||
          modifyKeywords.some(kw => promptLower.includes(kw)) ||  // Changed from startsWith to includes
          !!queryError ||  // Always replace if there's an error
          (currentResults && currentResults.rowCount === 0)  // Replace if query returned 0 rows
        );
        
        try { console.log('[bks-ai-shell] shouldReplace decision', {
          hasCurrentQuery: !!currentQuery,
          hasQueryError: !!queryError,
          queryErrorMessage: queryError?.message,
          prompt: prompt,
          promptLower: promptLower,
          shouldReplace: shouldReplace
        }); } catch {}
        
        // When there's an error, check if the query uses system views
        const usesSystemViews = currentQuery && (
          currentQuery.includes('sys.dm_') || 
          currentQuery.includes('sys.') ||
          currentQuery.includes('INFORMATION_SCHEMA')
        );
        
        // When there's an error, put the broken query and error at the very top
        const errorHeader = queryError ? [
          '❌ BROKEN QUERY THAT NEEDS FIXING:',
          '```sql',
          currentQuery || '',
          '```',
          '',
          `❌ ERROR: ${queryError.message}`,
          '',
          usesSystemViews ? '⚠️ SYSTEM VIEW QUERY - SPECIAL RULES:' : '⚠️ YOUR TASK: Fix the query above by:',
          usesSystemViews ? '1. This query uses SQL Server system views (sys.dm_*, sys.*, INFORMATION_SCHEMA)' : '1. Finding which column/table is invalid (see error message)',
          usesSystemViews ? '2. System views are ALWAYS available - do not check "Available Tables"' : '2. Looking in "Available Columns" below to find the correct table',
          usesSystemViews ? '3. Fix syntax errors, column names, or DMV usage' : '3. Adding a JOIN if the column is in a different table',
          usesSystemViews ? '4. Use correct T-SQL syntax for SQL Server' : '4. Updating the column reference to use the correct table alias',
          usesSystemViews ? '5. Keep the same query structure and logic' : '5. Keeping EVERYTHING else the same (same WHERE, same ORDER BY, same structure)',
          '',
          'OUTPUT FORMAT:',
          '-- [Explanation of what was wrong]',
          '-- [Original broken query, every line with --]',
          '',
          '-- Fixed query:',
          '[Same query with ONLY the error fixed]',
          '',
          '═══════════════════════════════════════════════════════════',
          '',
        ] : [];
        
        // For analysis mode, skip schema context - the prompt already contains everything needed
        const isAnalysisMode = (aiMode === 'analysis');
        
        // Build object definitions section if available
        const objectDefinitionsSection = objectDefinitions && Object.keys(objectDefinitions).length > 0 ? [
          '',
          '📋 OBJECT DEFINITIONS (CREATE Statements):',
          'The following database objects were mentioned with @ and their full definitions are provided:',
          '',
          ...Object.entries(objectDefinitions).map(([objKey, definition]) => [
            `-- ${objKey}:`,
            '```sql',
            definition,
            '```',
            ''
          ].join('\n')),
          '⚠️ CRITICAL INSTRUCTIONS FOR MENTIONED OBJECTS:',
          '1. When the user says "rewrite this" or "optimize this" or "improve this" about a mentioned object (@object):',
          '   - You MUST generate the complete rewritten CREATE statement (CREATE PROCEDURE/VIEW/FUNCTION)',
          '   - Include ALL original logic with your improvements',
          '   - Add comments explaining what you changed and why',
          '   - Do NOT just explain in natural language - provide the actual SQL code',
          '',
          '2. Use the CREATE statement above as the PRIMARY SOURCE',
          '3. Preserve all parameters, return types, and core functionality',
          '4. Only optimize performance, readability, or add error handling',
          '5. Call insert_sql with the complete rewritten CREATE statement',
          '',
        ] : [];
        
        const instruction = isAnalysisMode ? '' : [
          ...errorHeader,
          database ? `Database: ${database}` : '',
          '',
          ...objectDefinitionsSection,
          'Available Tables:',
          tblLines || '- (no tables found)',
          '',
          hasColumns ? 'Available Columns:\n' + colLines : '⚠️ Column information not provided - you have table names only.',
          hasColumns ? '' : 'You must infer likely column names based on:',
          hasColumns ? '' : '- Common database naming conventions (e.g., ID, Name, Date, Amount)',
          hasColumns ? '' : '- Table names (e.g., Product table likely has ProductID, ProductName)',
          hasColumns ? '' : '- Standard relationships (e.g., foreign keys like CustomerID, OrderID)',
          hasColumns ? '' : '- The user\'s question context',
          ...queryContext,
          '',
          !queryError ? '⚠️ CRITICAL RULES - YOU MUST FOLLOW THESE:' : '',
          !queryError ? '' : '',
          !queryError ? '1. SCHEMA CONTEXT:' : '',
          !queryError ? hasColumns ? '   - You are provided with tables and their columns' : '   - You are provided with table names only (no column details)' : '',
          !queryError ? hasColumns ? '   - The database may have more tables not shown here' : '   - Infer likely column names from table names and common conventions' : '',
          !queryError ? hasColumns ? '   - Work with the tables provided and make intelligent inferences' : '   - Use standard naming patterns (e.g., TableName + ID for primary keys)' : '',
          !queryError ? '   - If you need a table that is not listed, mention it in a comment' : '',
          !queryError ? '' : '',
          !queryError ? '2. VALIDATION: Before writing any query, verify that:' : '',
          !queryError ? '   - Every table you reference exists in "Available Tables" above' : '',
          !queryError ? hasColumns ? '   - Every column you reference exists in "Available Columns" for that specific table' : '   - Column names follow common conventions and make sense for the table' : '',
          !queryError ? '   - You use the correct schema prefix (e.g., Sales.Customer, not just Customer)' : '',
          !queryError ? '' : '',
          !queryError ? hasColumns ? '3. If a column you need does not exist in the table you think it should be in:' : '3. When inferring column names:' : '',
          !queryError ? hasColumns ? '   - Search through ALL tables in "Available Columns" to find which table actually has it' : '   - Use common patterns: ID, Name, Date, Amount, Status, Type, Description' : '',
          !queryError ? hasColumns ? '   - Add the appropriate JOIN to that table' : '   - Primary keys: TableNameID (e.g., ProductID, CustomerID)' : '',
          !queryError ? hasColumns ? '   - If the table/column is not available, mention it clearly in a comment' : '   - Foreign keys: ReferencedTableID (e.g., CustomerID in Orders table)' : '',
          !queryError ? hasColumns ? '' : '   - Dates: CreatedDate, ModifiedDate, OrderDate, etc.' : '',
          !queryError ? '' : '',
          !queryError ? hasColumns ? '4. NEVER invent or assume column names - only use columns that are explicitly listed' : '4. Be confident in your inferences - standard naming conventions are reliable' : '',
          !queryError ? '' : '',
          !queryError ? '5. If the user request references "this query" or "these results", use the Current Query and Last Query Results context above' : '',
          !queryError ? '' : '',
          !queryError ? '6. Do not include LIMIT/TOP unless explicitly requested' : '',
          !queryError ? '' : '',
          !queryError ? '7. For SQL Server, use proper T-SQL syntax (e.g., TOP N instead of LIMIT N)' : '',
          '',
          !queryError ? '8. SQL SERVER DDL RULES (MUST FOLLOW):' : '',
          !queryError ? '   - NEVER use: ALTER INDEX ... (key columns) INCLUDE (...) WITH (DROP_EXISTING=ON ...). This is invalid T-SQL.' : '',
          !queryError ? '   - To change index keys/INCLUDE: use CREATE [NONCLUSTERED] INDEX ... ON ... INCLUDE (...) WITH (DROP_EXISTING=ON, ...).' : '',
          !queryError ? '   - To rebuild only: ALTER INDEX ... ON ... REBUILD WITH (...).' : '',
          !queryError ? '   - NEVER use CREATE OR REPLACE in SQL Server. Use CREATE OR ALTER for VIEW/PROC/FUNCTION.' : '',
          !queryError ? '   - SQL Server does NOT support LIMIT. Use TOP or OFFSET/FETCH.' : '',
        ].filter(Boolean).join('\n');
        
        try { console.log('[bks-ai-shell] Instruction being sent to LLM (first 500 chars):', instruction.substring(0, 500)); } catch {}
        
        const chat = useChatStore();
        // Global Expert DBA Persona (same as ChatInterface.vue)
        const expertDBAPersona = [
          '# EXPERT MICROSOFT SQL SERVER DBA AI',
          '',
          'You are an Expert Microsoft SQL Server DBA AI with over 15 years of real-world production experience.',
          '',
          'You specialize in:',
          '- Index design, maintenance, and tuning',
          '- Query performance optimization',
          '- Large-scale OLTP and mixed workloads',
          '- High-concurrency environments',
          '- Always On Availability Groups and HA/DR systems',
          '',
          'You think and act like a senior human DBA responsible for uptime, data correctness, and operational risk.',
          'You are not a code generator and you do not make speculative changes.',
          '',
          'Your guiding principles:',
          '- Correctness over performance',
          '- Stability over cleverness',
          '- Production safety over experimentation',
          '- Prefer proven fixes over risky rewrites',
          '- When in doubt, recommend no change',
          '',
          '🚨 DEFAULT DBA RULE:',
          'If the system is stable, performance is acceptable, and risks outweigh benefits:',
          '- Recommend NO CHANGE',
          '- Explain why stability is preferred',
          '- Doing nothing is often the correct answer',
          '',
          'You never run anything automatically.',
          'You provide scripts, explanations, risks, and rollback guidance.',
          'You always explain WHY a recommendation is made.',
          '',
          'If a system is healthy or a change is risky, you explicitly say so.',
          '',
          '🔐 GLOBAL QUERY SAFETY RULE:',
          'Any query rewrite MUST return the exact same results as the original query.',
          'This includes:',
          '- Same row count',
          '- Same column values',
          '- Same data types',
          '- Same NULL behavior',
          '- Same duplicate behavior',
          '- Same ordering if ORDER BY exists',
          '',
          'If result equivalence cannot be guaranteed with high confidence:',
          '- Do NOT rewrite the query',
          '- Prefer index, statistics, or configuration fixes',
          '',
          '📊 EXECUTION PLAN AUTHORITY RULE:',
          'If an actual execution plan or statistics are available:',
          '- They MUST be used as the primary authority',
          '- Prefer actual row counts over estimates',
          '- Do NOT rewrite queries with already optimal plans',
          '- If statistics are stale, recommend fixing statistics BEFORE any rewrite',
          '',
          'Heuristics are allowed only when no plan or stats exist.',
          'Plans override heuristics. Real metrics override assumptions.',
          '',
        ].join('\n');

        let model = chat?.model;
        if (!model || !model.id) {
          try { await chat.initialize(); model = chat.model; } catch (e) { console.warn('[bks-ai-shell] chat.initialize() failed', e); }
        }
        
        if (model && model.provider && model.id) {
          const provider = await createProvider(model.provider as any);
          
          // Use explicit mode from toggle instead of auto-detection
          const isDBAMode = (aiMode === 'dba' || aiMode === 'analysis');
          
          try { console.log('[bks-ai-shell] AI Mode:', isDBAMode ? 'DBA (Performance/Tuning)' : 'Developer (SQL Generation)'); } catch {}
          
          if (isDBAMode && !queryError) {
            // For DBA questions, create a special instruction that allows system views
            const dbaInstruction = [
              database ? `Database: ${database}` : '',
              '',
              'User Tables (for reference only - DO NOT use these for DBA queries):',
              tblLines || '- (no user tables found)',
              '',
              '⚠️⚠️⚠️ CRITICAL DBA MODE RULES - READ CAREFULLY ⚠️⚠️⚠️',
              '',
              '1. You are in DBA MODE - answering performance/monitoring questions',
              '2. IGNORE the "User Tables" list above - it is only for reference',
              '3. You MUST use SQL Server system DMVs and catalog views, including but not limited to:',
              '',
              '   Performance & Execution:',
              '   - sys.dm_exec_query_stats, sys.dm_exec_requests, sys.dm_exec_sessions',
              '   - sys.dm_exec_sql_text, sys.dm_exec_query_plan, sys.dm_exec_cached_plans',
              '',
              '   Wait Statistics:',
              '   - sys.dm_os_wait_stats, sys.dm_os_waiting_tasks',
              '   - sys.dm_os_ring_buffers (for CPU/memory ring buffer data)',
              '   - sys.dm_os_sys_info, sys.dm_os_performance_counters',
              '',
              '   Index & Storage:',
              '   - sys.dm_db_index_physical_stats, sys.dm_db_index_usage_stats',
              '   - sys.indexes, sys.tables, sys.columns, sys.partitions',
              '   - sys.dm_db_partition_stats',
              '',
              '   Blocking & Locks:',
              '   - sys.dm_tran_locks, sys.dm_exec_connections',
              '   - sys.dm_os_waiting_tasks',
              '',
              '4. THESE SYSTEM VIEWS ARE ALWAYS AVAILABLE - they exist in every SQL Server instance',
              '5. DO NOT check if these views exist in "User Tables" - they are system objects',
              '6. DO NOT say "this view is not in the schema" - system views are not in user schema',
              '7. ALWAYS provide executable SQL queries using these system views',
              '8. If a column or view does not exist, use the correct SQL Server DMV that has it',
              '',
              '9. Format: Comments explaining the query, then actual executable SQL',
              '10. Use proper T-SQL syntax for SQL Server',
            ].filter(Boolean).join('\n');
            
            // TWO-PHASE AGENTIC APPROACH FOR SLASH COMMANDS (except sp_blitz/sp_whoisactive)
            if (isSlashCommand && !bypassAI && !bypassThreePhase) {
              try { console.log('[bks-ai-shell] Starting Phase 1: Requesting system objects from AI'); } catch {}
              
              // PHASE 1: Ask AI which system objects it needs
              const phase1Schema = z.object({
                systemObjects: z.array(z.string())
                  .describe('List of SQL Server system objects (DMVs, views, procedures, functions) needed to answer this request. Examples: sys.dm_exec_query_stats, sys.dm_os_ring_buffers, sp_WhoIsActive, INFORMATION_SCHEMA.COLUMNS')
              });
              
              const phase1Prompt = `${expertDBAPersona}

User Request: ${prompt}
Database: ${database || 'master'}

TASK: Analyze this request and determine ALL SQL Server system objects you need to generate the correct SQL.

AVAILABLE SYSTEM OBJECT TYPES:
- System DMVs: sys.dm_* (e.g., sys.dm_exec_query_stats, sys.dm_os_wait_stats, sys.dm_os_ring_buffers, sys.dm_db_missing_index_details)
- System Catalog Views: sys.* (e.g., sys.tables, sys.indexes, sys.columns, sys.objects)
- System Stored Procedures: sp_* (e.g., sp_WhoIsActive, sp_Blitz, sp_BlitzCache)
- INFORMATION_SCHEMA views: INFORMATION_SCHEMA.* (e.g., INFORMATION_SCHEMA.COLUMNS, INFORMATION_SCHEMA.TABLES)
- System Functions: fn_* (e.g., fn_dblog, fn_virtualfilestats)
- MSDB Database Objects: msdb.dbo.*, msdb.sys.*, msdb.INFORMATION_SCHEMA.* (e.g., msdb.dbo.backupset, msdb.dbo.sysjobs, msdb.sys.tables)
- Model Database Objects: model.dbo.*, model.sys.*, model.INFORMATION_SCHEMA.* (e.g., model.sys.tables, model.dbo.* user tables)

🚨 CRITICAL INSTRUCTIONS:
1. Think carefully about ALL system objects you will need for your SQL query
2. List EVERY system object you plan to use - missing even one will cause errors
3. For index analysis: include all relevant sys.dm_db_missing_index_* views
4. For performance analysis: include all relevant sys.dm_exec_* and sys.dm_os_* DMVs
5. For backup/restore history: ALWAYS use msdb.dbo.backupset, msdb.dbo.backupmediafamily, msdb.dbo.restorehistory (backup history is ONLY in msdb database, NOT in sys.databases or sys.master_files)
6. You can query objects from ANY database (master, msdb, model) regardless of which database you're currently connected to - use full 3-part names (database.schema.object)
7. Be specific with full names including schema (e.g., "sys.dm_exec_query_stats" not "dm_exec_query_stats")
8. Include related objects that work together (e.g., if querying missing indexes, include the group and stats tables too)

⚠️ IMPORTANT: In Phase 2, you will ONLY be able to use the objects you list here. If you forget an object, you won't be able to use it.

Return the complete list of ALL system objects you need. I will fetch their exact schemas and send them back to you.`;

              const phase1Result = await provider.generateObject<{ systemObjects: string[] }>({
                modelId: model.id as any,
                schema: phase1Schema,
                prompt: phase1Prompt,
                providerId: model.provider as any,
              });
              
              const requestedObjectsRaw = normalizeObjectList(phase1Result?.object?.systemObjects || []);
              const requestedObjects = requestedObjectsRaw;
              try { console.log('[bks-ai-shell] Phase 1 complete. AI requested', requestedObjects.length, 'system objects:', requestedObjects); } catch {}
              
              if (requestedObjects.length > 0) {
                // Request schemas from CoreTabs
                try { console.log('[bks-ai-shell] Requesting schemas from CoreTabs...'); } catch {}
                let schemasResponse = await requestSystemObjectSchemas(requestedObjects, requestId);

                // Dynamic refinement: after seeing schemas, allow AI to request additional objects (no hardcoding)
                try {
                  if (schemasResponse && Object.keys(schemasResponse).length > 0) {
                    const schemaSection = buildSystemSchemaSection(schemasResponse);
                    const refineSchema = z.object({
                      additionalSystemObjects: z.array(z.string()).describe('Additional system objects you need schemas for. Return [] if none.')
                    });
                    const refinePrompt = `${expertDBAPersona}

User Request: ${prompt}
Database: ${database || 'master'}

You have schemas for these system objects:

${schemaSection}

TASK: If you need any additional system objects to build a correct query (joins, helper DMVs, group/stats tables, etc.), list them now.

RULES:
1. Return ONLY the additional object names (full names with schema), or [] if nothing else is needed.
2. Do NOT generate SQL yet.
3. Do NOT repeat objects already listed above.`;

                    const refineResult = await provider.generateObject<{ additionalSystemObjects: string[] }>({
                      modelId: model.id as any,
                      schema: refineSchema,
                      prompt: refinePrompt,
                      providerId: model.provider as any,
                    });

                    const additional = normalizeObjectList(refineResult?.object?.additionalSystemObjects || []);
                    const additionalFiltered = additional.filter((o) => !(o.toLowerCase() in Object.keys(schemasResponse).reduce((acc: any, k: string) => { acc[String(k).toLowerCase()] = true; return acc; }, {})));

                    if (additionalFiltered.length > 0) {
                      try { console.log('[bks-ai-shell] DBA refinement: fetching additional schemas:', additionalFiltered); } catch {}
                      const moreSchemas = await requestSystemObjectSchemas(additionalFiltered, requestId);
                      schemasResponse = mergeSchemas(schemasResponse, moreSchemas);
                    }
                  }
                } catch (_) {}
                
                if (schemasResponse && Object.keys(schemasResponse).length > 0) {
                  try { console.log('[bks-ai-shell] Phase 1.5: Asking AI to acknowledge schemas'); } catch {}
                  
                  // PHASE 1.5: Force AI to acknowledge and list available columns
                  const schemaSection = buildSystemSchemaSection(schemasResponse);
                  
                  const phase15Schema = z.object({
                    acknowledgment: z.string().describe('Brief acknowledgment that you have read the schemas'),
                    availableObjects: z.array(z.object({
                      objectName: z.string().describe('Full object name (e.g., sys.dm_db_missing_index_group_stats)'),
                      objectType: z.string().describe('Object type (view, table_valued_function, etc.)'),
                      columns: z.array(z.string()).describe('List of ALL column names available in this object')
                    })).describe('List each system object with its available columns')
                  });
                  
                  const phase15Prompt = `You have requested schemas for the following system objects. 

${schemaSection}

TASK: Read the schemas above carefully and list back to me:
1. Each system object name
2. Its type (view, table_valued_function, etc.)
3. ALL available column names for that object

This is a verification step to ensure you understand what columns are available before generating SQL.

DO NOT generate SQL yet. Just acknowledge the schemas and list the available columns.`;

                  const phase15Result = await provider.generateObject<{
                    acknowledgment: string;
                    availableObjects: Array<{
                      objectName: string;
                      objectType: string;
                      columns: string[];
                    }>;
                  }>({
                    modelId: model.id as any,
                    schema: phase15Schema,
                    prompt: phase15Prompt,
                    providerId: model.provider as any,
                  });
                  
                  try { 
                    console.log('[bks-ai-shell] Phase 1.5 complete. AI acknowledged', phase15Result?.object?.availableObjects?.length || 0, 'objects'); 
                    console.log('[bks-ai-shell] Phase 1.5 AI acknowledgment:', JSON.stringify(phase15Result?.object, null, 2).substring(0, 500));
                  } catch {}
                  
                  // PHASE 2: Generate SQL with FULL schema details (not just AI's acknowledgment)
                  try { console.log('[bks-ai-shell] Phase 2: Generating SQL with full schema details'); } catch {}
                  
                  const phase2Schema = z.object({ 
                    response: z.string()
                      .min(1)
                      .describe('Provide executable T-SQL with comments. Use ONLY the exact columns from the schemas below.')
                  });
                  
                  // Build detailed schema reference with ACTUAL column details from fetched schemas
                  let detailedSchemaReference = '\n\n📋 AVAILABLE SYSTEM OBJECTS AND THEIR COLUMNS:\n';
                  detailedSchemaReference += '⚠️ CRITICAL: You can ONLY use these exact column names. DO NOT use any other columns.\n\n';
                  
                  // Track object types for T-SQL syntax warnings
                  const tableValuedFunctions: string[] = [];
                  const scalarFunctions: string[] = [];
                  const procedures: string[] = [];
                  
                  for (const [objName, schema] of Object.entries(schemasResponse)) {
                    const objType = schema.objectType || 'view';
                    detailedSchemaReference += `\n${objName} [${objType.toUpperCase().replace(/_/g, ' ')}]:\n`;
                    
                    // Track object types
                    if (objType === 'table_valued_function' || objType === 'inline_table_valued_function') {
                      tableValuedFunctions.push(objName);
                    } else if (objType === 'scalar_function') {
                      scalarFunctions.push(objName);
                    } else if (objType === 'stored_procedure') {
                      procedures.push(objName);
                    }
                    
                    if (schema.columns && schema.columns.length > 0) {
                      detailedSchemaReference += '  Available columns:\n';
                      for (const col of schema.columns) {
                        detailedSchemaReference += `    - ${col.name} (${col.type})\n`;
                      }
                    }
                    
                    if (schema.parameters && schema.parameters.length > 0) {
                      detailedSchemaReference += '  Parameters:\n';
                      for (const param of schema.parameters) {
                        detailedSchemaReference += `    - ${param.name} (${param.type})\n`;
                      }
                    }
                  }
                  
                  // Add T-SQL syntax warnings for table-valued functions
                  if (tableValuedFunctions.length > 0) {
                    detailedSchemaReference += '\n\n🚨 TABLE-VALUED FUNCTIONS - CRITICAL T-SQL SYNTAX:\n';
                    detailedSchemaReference += `The following are TABLE-VALUED FUNCTIONS: ${tableValuedFunctions.join(', ')}\n`;
                    detailedSchemaReference += '❌ NEVER use JOIN syntax: INNER JOIN sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += '✅ ALWAYS use APPLY syntax: CROSS APPLY sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += '✅ Or use: OUTER APPLY sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += 'Example: FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
                  }
                  
                  if (scalarFunctions.length > 0) {
                    detailedSchemaReference += '\n\n🚨 SCALAR FUNCTIONS:\n';
                    detailedSchemaReference += `The following are SCALAR FUNCTIONS: ${scalarFunctions.join(', ')}\n`;
                    detailedSchemaReference += 'These return a single value and can be used in SELECT, WHERE, or other expressions\n';
                  }
                  
                  if (procedures.length > 0) {
                    detailedSchemaReference += '\n\n🚨 STORED PROCEDURES:\n';
                    detailedSchemaReference += `The following are STORED PROCEDURES: ${procedures.join(', ')}\n`;
                    detailedSchemaReference += 'Use EXEC or EXECUTE to call these procedures\n';
                  }
                  
                  detailedSchemaReference += '\n\n🚨 VALIDATION RULES:\n';
                  detailedSchemaReference += '1. Every column you reference MUST be in the list above\n';
                  detailedSchemaReference += '2. Every table/view you use MUST be in the list above\n';
                  detailedSchemaReference += '3. If you need a column that is not listed, you CANNOT use it\n';
                  detailedSchemaReference += '4. Double-check every SELECT, WHERE, ORDER BY, and JOIN clause\n';
                  detailedSchemaReference += '5. For table-valued functions, use CROSS APPLY or OUTER APPLY, NOT JOIN\n';
                  
                  detailedSchemaReference += '\n\n🚨 T-SQL FUNCTION RESTRICTIONS:\n';
                  detailedSchemaReference += '❌ DO NOT USE: TRY_CONVERT (does not exist in SQL Server)\n';
                  detailedSchemaReference += '✅ USE INSTEAD: CONVERT(datatype, expression) or CAST(expression AS datatype)\n';
                  detailedSchemaReference += '❌ DO NOT USE: TRY_PARSE (does not exist in SQL Server)\n';
                  detailedSchemaReference += '✅ USE INSTEAD: CAST or CONVERT with proper error handling\n';
                  detailedSchemaReference += 'Example: CONVERT(INT, column_name) or CAST(column_name AS INT)\n';
                  
                  const phase2Prompt = `${expertDBAPersona}

User Request: ${prompt}
Database: ${database || 'master'}

${detailedSchemaReference}

🚨 CRITICAL INSTRUCTIONS:
1. Use ONLY the exact column names listed above
2. DO NOT reference any columns not explicitly listed
3. DO NOT assume columns exist based on common naming patterns
4. Before using any column, verify it exists in the schema above
5. If you need to order by a column, make sure it's in your SELECT or JOIN
6. DO NOT use TRY_CONVERT or TRY_PARSE - use CONVERT or CAST instead
7. Generate production-ready, executable T-SQL that will pass SQL Server validation
8. Add comments explaining the query

Generate the complete SQL query now using ONLY the columns explicitly listed above.`;

                  const phase2Result = await provider.generateObject<{ response: string }>({
                    modelId: model.id as any,
                    schema: phase2Schema,
                    prompt: phase2Prompt,
                    providerId: model.provider as any,
                    queryText: currentQuery || undefined,
                  });
                  
                  sql = (phase2Result?.object as any)?.response || '';
                } else {
                  try { console.warn('[bks-ai-shell] No schemas received, falling back to single-phase generation'); } catch {}
                  // Fallback to single-phase if schema fetch failed
                  const dbaSchema = z.object({ 
                    response: z.string().min(1).describe('Provide executable T-SQL with comments')
                  });
                  
                  const obj = await provider.generateObject<{ response: string }>({
                    modelId: model.id as any,
                    schema: dbaSchema,
                    prompt: expertDBAPersona + '\n\n' + commandPrompt,
                    providerId: model.provider as any,
                    queryText: currentQuery || undefined,
                  });
                  
                  sql = (obj?.object as any)?.response || '';
                }
              } else {
                try { console.warn('[bks-ai-shell] AI requested 0 system objects, using fallback'); } catch {}
                // Fallback if AI didn't request any objects
                const dbaSchema = z.object({ 
                  response: z.string().min(1).describe('Provide executable T-SQL with comments')
                });
                
                const obj = await provider.generateObject<{ response: string }>({
                  modelId: model.id as any,
                  schema: dbaSchema,
                  prompt: expertDBAPersona + '\n\n' + commandPrompt,
                  providerId: model.provider as any,
                  queryText: currentQuery || undefined,
                });
                
                sql = (obj?.object as any)?.response || '';
              }
            } else if (bypassThreePhase && !bypassAI) {
              // sp_blitz* and sp_whoisactive* commands - use single-phase AI with stored procedure prompts
              try { console.log('[bks-ai-shell] sp_blitz/sp_whoisactive command - using single-phase AI with procedure prompts'); } catch {}
              
              const dbaSchema = z.object({ 
                response: z.string().min(1).describe('Provide executable T-SQL EXEC statement with proper parameters')
              });
              
              const obj = await provider.generateObject<{ response: string }>({
                modelId: model.id as any,
                schema: dbaSchema,
                prompt: expertDBAPersona + '\n\n' + commandPrompt,
                providerId: model.provider as any,
                queryText: currentQuery || undefined,
              });
              
              sql = (obj?.object as any)?.response || '';
            } else if (!bypassAI) {
              // Non-slash command DBA mode - also use 3-phase workflow
              try { console.log('[bks-ai-shell] Non-slash DBA query, starting 3-phase workflow'); } catch {}
              
              // PHASE 1: Ask AI which system objects it needs
              const phase1Schema = z.object({
                systemObjects: z.array(z.string())
                  .describe('List of SQL Server system objects (DMVs, views, procedures, functions) needed to answer this request. Examples: sys.dm_exec_query_stats, sys.dm_os_wait_stats, sys.databases')
              });
              
              const phase1Prompt = `${expertDBAPersona}

User Question: ${prompt}
Database: ${database || 'master'}

TASK: Analyze this DBA question and determine ALL SQL Server system objects you need to answer it with executable SQL.

AVAILABLE SYSTEM OBJECT TYPES:
- System DMVs: sys.dm_* (e.g., sys.dm_exec_query_stats, sys.dm_os_wait_stats, sys.dm_os_ring_buffers, sys.dm_db_missing_index_details)
- System Catalog Views: sys.* (e.g., sys.tables, sys.indexes, sys.columns, sys.objects)
- System Stored Procedures: sp_* (e.g., sp_WhoIsActive, sp_Blitz, sp_BlitzCache)
- INFORMATION_SCHEMA views: INFORMATION_SCHEMA.* (e.g., INFORMATION_SCHEMA.COLUMNS, INFORMATION_SCHEMA.TABLES)
- System Functions: fn_* (e.g., fn_dblog, fn_virtualfilestats)
- MSDB Database Objects: msdb.dbo.*, msdb.sys.*, msdb.INFORMATION_SCHEMA.* (e.g., msdb.dbo.backupset, msdb.dbo.sysjobs, msdb.sys.tables)
- Model Database Objects: model.dbo.*, model.sys.*, model.INFORMATION_SCHEMA.* (e.g., model.sys.tables, model.dbo.* user tables)

🚨 CRITICAL INSTRUCTIONS:
1. Think carefully about ALL system objects you will need for your SQL query
2. List EVERY system object you plan to use - missing even one will cause errors
3. For index analysis: include all relevant sys.dm_db_missing_index_* views
4. For performance analysis: include all relevant sys.dm_exec_* and sys.dm_os_* DMVs
5. For backup/restore history: ALWAYS use msdb.dbo.backupset, msdb.dbo.backupmediafamily, msdb.dbo.restorehistory (backup history is ONLY in msdb database, NOT in sys.databases or sys.master_files)
6. You can query objects from ANY database (master, msdb, model) regardless of which database you're currently connected to - use full 3-part names (database.schema.object)
7. Be specific with full names including schema (e.g., "sys.dm_exec_query_stats" not "dm_exec_query_stats")
8. Include related objects that work together (e.g., if querying missing indexes, include the group and stats tables too)

⚠️ IMPORTANT: In Phase 2, you will ONLY be able to use the objects you list here. If you forget an object, you won't be able to use it.

Return the complete list of ALL system objects you need.`;

              const phase1Result = await provider.generateObject<{ systemObjects: string[] }>({
                modelId: model.id as any,
                schema: phase1Schema,
                prompt: phase1Prompt,
                providerId: model.provider as any,
              });
              
              const requestedObjectsRaw = normalizeObjectList(phase1Result?.object?.systemObjects || []);
              const requestedObjects = requestedObjectsRaw;
              try { console.log('[bks-ai-shell] Non-slash Phase 1 complete. AI requested', requestedObjects.length, 'system objects:', requestedObjects); } catch {}
              
              if (requestedObjects.length > 0) {
                // Request schemas from CoreTabs
                let schemasResponse = await requestSystemObjectSchemas(requestedObjects, requestId);

                // Dynamic refinement: after seeing schemas, allow AI to request additional objects (no hardcoding)
                try {
                  if (schemasResponse && Object.keys(schemasResponse).length > 0) {
                    const schemaSection = buildSystemSchemaSection(schemasResponse);
                    const refineSchema = z.object({
                      additionalSystemObjects: z.array(z.string()).describe('Additional system objects you need schemas for. Return [] if none.')
                    });
                    const refinePrompt = `${expertDBAPersona}

User Question: ${prompt}
Database: ${database || 'master'}

You have schemas for these system objects:

${schemaSection}

TASK: If you need any additional system objects to build a correct query (joins, helper DMVs, group/stats tables, etc.), list them now.

RULES:
1. Return ONLY the additional object names (full names with schema), or [] if nothing else is needed.
2. Do NOT generate SQL yet.
3. Do NOT repeat objects already listed above.`;

                    const refineResult = await provider.generateObject<{ additionalSystemObjects: string[] }>({
                      modelId: model.id as any,
                      schema: refineSchema,
                      prompt: refinePrompt,
                      providerId: model.provider as any,
                    });

                    const additional = normalizeObjectList(refineResult?.object?.additionalSystemObjects || []);
                    const additionalFiltered = additional.filter((o) => !(o.toLowerCase() in Object.keys(schemasResponse).reduce((acc: any, k: string) => { acc[String(k).toLowerCase()] = true; return acc; }, {})));
                    if (additionalFiltered.length > 0) {
                      try { console.log('[bks-ai-shell] Non-slash DBA refinement: fetching additional schemas:', additionalFiltered); } catch {}
                      const moreSchemas = await requestSystemObjectSchemas(additionalFiltered, requestId);
                      schemasResponse = mergeSchemas(schemasResponse, moreSchemas);
                    }
                  }
                } catch (_) {}
                
                if (schemasResponse && Object.keys(schemasResponse).length > 0) {
                  try { console.log('[bks-ai-shell] Non-slash Phase 1.5: Asking AI to acknowledge schemas'); } catch {}
                  
                  // PHASE 1.5: Force AI to acknowledge schemas
                  const schemaSection = buildSystemSchemaSection(schemasResponse);
                  
                  const phase15Schema = z.object({
                    acknowledgment: z.string().describe('Brief acknowledgment that you have read the schemas'),
                    availableObjects: z.array(z.object({
                      objectName: z.string().describe('Full object name'),
                      objectType: z.string().describe('Object type'),
                      columns: z.array(z.string()).describe('List of ALL column names available')
                    })).describe('List each system object with its available columns')
                  });
                  
                  const phase15Prompt = `You have requested schemas for the following system objects. 

${schemaSection}

TASK: Read the schemas above carefully and list back to me:
1. Each system object name
2. Its type (view, table_valued_function, etc.)
3. ALL available column names for that object

This is a verification step to ensure you understand what columns are available before generating SQL.

DO NOT generate SQL yet. Just acknowledge the schemas and list the available columns.`;

                  const phase15Result = await provider.generateObject<{
                    acknowledgment: string;
                    availableObjects: Array<{
                      objectName: string;
                      objectType: string;
                      columns: string[];
                    }>;
                  }>({
                    modelId: model.id as any,
                    schema: phase15Schema,
                    prompt: phase15Prompt,
                    providerId: model.provider as any,
                  });
                  
                  try { 
                    console.log('[bks-ai-shell] Non-slash Phase 1.5 complete. AI acknowledged', phase15Result?.object?.availableObjects?.length || 0, 'objects'); 
                  } catch {}
                  
                  // PHASE 2: Generate SQL with FULL schema details
                  try { console.log('[bks-ai-shell] Non-slash Phase 2: Generating SQL with full schema details'); } catch {}
                  
                  const phase2Schema = z.object({ 
                    response: z.string()
                      .min(1)
                      .describe('Provide executable T-SQL with comments. Use ONLY the exact columns from the schemas below.')
                  });
                  
                  // Build detailed schema reference
                  let detailedSchemaReference = '\n\n📋 AVAILABLE SYSTEM OBJECTS AND THEIR COLUMNS:\n';
                  detailedSchemaReference += '⚠️ CRITICAL: You can ONLY use these exact column names. DO NOT use any other columns.\n\n';
                  
                  // Track object types for T-SQL syntax warnings
                  const tableValuedFunctions: string[] = [];
                  const scalarFunctions: string[] = [];
                  const procedures: string[] = [];
                  
                  for (const [objName, schema] of Object.entries(schemasResponse)) {
                    const objType = schema.objectType || 'view';
                    detailedSchemaReference += `\n${objName} [${objType.toUpperCase().replace(/_/g, ' ')}]:\n`;
                    
                    // Track object types
                    if (objType === 'table_valued_function' || objType === 'inline_table_valued_function') {
                      tableValuedFunctions.push(objName);
                    } else if (objType === 'scalar_function') {
                      scalarFunctions.push(objName);
                    } else if (objType === 'stored_procedure') {
                      procedures.push(objName);
                    }
                    
                    if (schema.columns && schema.columns.length > 0) {
                      detailedSchemaReference += '  Available columns:\n';
                      for (const col of schema.columns) {
                        detailedSchemaReference += `    - ${col.name} (${col.type})\n`;
                      }
                    }
                    
                    if (schema.parameters && schema.parameters.length > 0) {
                      detailedSchemaReference += '  Parameters:\n';
                      for (const param of schema.parameters) {
                        detailedSchemaReference += `    - ${param.name} (${param.type})\n`;
                      }
                    }
                  }
                  
                  // Add T-SQL syntax warnings for table-valued functions
                  if (tableValuedFunctions.length > 0) {
                    detailedSchemaReference += '\n\n🚨 TABLE-VALUED FUNCTIONS - CRITICAL T-SQL SYNTAX:\n';
                    detailedSchemaReference += `The following are TABLE-VALUED FUNCTIONS: ${tableValuedFunctions.join(', ')}\n`;
                    detailedSchemaReference += '❌ NEVER use JOIN syntax: INNER JOIN sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += '✅ ALWAYS use APPLY syntax: CROSS APPLY sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += '✅ Or use: OUTER APPLY sys.dm_exec_sql_text(...) AS t\n';
                    detailedSchemaReference += 'Example: FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\n';
                  }
                  
                  if (scalarFunctions.length > 0) {
                    detailedSchemaReference += '\n\n🚨 SCALAR FUNCTIONS:\n';
                    detailedSchemaReference += `The following are SCALAR FUNCTIONS: ${scalarFunctions.join(', ')}\n`;
                    detailedSchemaReference += 'These return a single value and can be used in SELECT, WHERE, or other expressions\n';
                  }
                  
                  if (procedures.length > 0) {
                    detailedSchemaReference += '\n\n🚨 STORED PROCEDURES:\n';
                    detailedSchemaReference += `The following are STORED PROCEDURES: ${procedures.join(', ')}\n`;
                    detailedSchemaReference += 'Use EXEC or EXECUTE to call these procedures\n';
                  }
                  
                  detailedSchemaReference += '\n\n🚨 VALIDATION RULES:\n';
                  detailedSchemaReference += '1. Every column you reference MUST be in the list above\n';
                  detailedSchemaReference += '2. Every table/view you use MUST be in the list above\n';
                  detailedSchemaReference += '3. If you need a column that is not listed, you CANNOT use it\n';
                  detailedSchemaReference += '4. Double-check every SELECT, WHERE, ORDER BY, and JOIN clause\n';
                  detailedSchemaReference += '5. For table-valued functions, use CROSS APPLY or OUTER APPLY, NOT JOIN\n';
                  detailedSchemaReference += '6. Verify all table aliases are correctly defined and used\n';
                  detailedSchemaReference += '7. When joining tables, ensure the join columns exist in BOTH tables\n';
                  detailedSchemaReference += '8. For system functions/procs listed above, ONLY use the parameters listed in the schema section (do NOT invent extra arguments)\n';
                  
                  const phase2Prompt = `${expertDBAPersona}

User Question: ${prompt}
Database: ${database || 'master'}

${detailedSchemaReference}

🚨 CRITICAL INSTRUCTIONS:
1. Use ONLY the exact column names listed above
2. DO NOT reference any columns not explicitly listed
3. DO NOT assume columns exist based on common naming patterns
4. Before using any column, verify it exists in the schema above
5. Verify ALL table aliases are correctly defined in FROM/JOIN/APPLY clauses
6. When referencing a column with an alias (e.g., t.column_name), ensure:
   - The alias 't' is defined in a FROM, JOIN, or APPLY clause
   - The column 'column_name' exists in that table's schema above
7. When joining tables, verify the join columns exist in BOTH tables' schemas
8. Generate production-ready, executable T-SQL that will run without errors
9. Add comments explaining the query logic

SYSTEM FUNCTION/PROC PARAMETER RULE (CRITICAL):
- If you call any system function/procedure shown in SYSTEM OBJECT SCHEMAS above and it has a "Parameters:" line,
  you MUST match that signature exactly.
- Do NOT add extra arguments.
- If the user request seems to require parameters you don't have, ask a clarifying question instead of guessing.

VALIDATION CHECKLIST before generating:
✓ Every column referenced exists in the schemas above
✓ Every table alias is properly defined
✓ Every join condition uses columns that exist in both tables
✓ Table-valued functions use APPLY, not JOIN
✓ System functions/procs are called with the correct parameter counts

Generate the complete SQL query now using ONLY the columns explicitly listed above.`;

                  const phase2Result = await provider.generateObject<{ response: string }>({
                    modelId: model.id as any,
                    schema: phase2Schema,
                    prompt: phase2Prompt,
                    providerId: model.provider as any,
                    queryText: currentQuery || undefined,
                  });
                  
                  sql = (phase2Result?.object as any)?.response || '';
                } else {
                  // Fallback if schema fetch failed
                  try { console.warn('[bks-ai-shell] Non-slash: No schemas received, using fallback'); } catch {}
                  const dbaSchema = z.object({ 
                    response: z.string().min(1).describe('Provide executable T-SQL with comments')
                  });
                  
                  const obj = await provider.generateObject<{ response: string }>({
                    modelId: model.id as any,
                    schema: dbaSchema,
                    prompt: expertDBAPersona + '\n\n' + dbaInstruction + '\n\nDBA Question:\n' + String(prompt || ''),
                    providerId: model.provider as any,
                    queryText: currentQuery || undefined,
                  });
                  
                  sql = (obj?.object as any)?.response || '';
                }
              } else {
                // Fallback if AI didn't request any objects
                try { console.warn('[bks-ai-shell] Non-slash: AI requested 0 objects, using fallback'); } catch {}
                const dbaSchema = z.object({ 
                  response: z.string().min(1).describe('Provide executable T-SQL with comments')
                });
                
                const obj = await provider.generateObject<{ response: string }>({
                  modelId: model.id as any,
                  schema: dbaSchema,
                  prompt: expertDBAPersona + '\n\n' + dbaInstruction + '\n\nDBA Question:\n' + String(prompt || ''),
                  providerId: model.provider as any,
                  queryText: currentQuery || undefined,
                });
                
                sql = (obj?.object as any)?.response || '';
              }
            }
            // If bypassAI is true, sql is already set from the pre-generated script
          } else {
            // Check if this is a DDL operation (CREATE INDEX, ALTER TABLE, etc.)
            const promptLowerCase = (prompt || '').toLowerCase();
            const isDDLOperation = 
              promptLowerCase.includes('create index') ||
              promptLowerCase.includes('suggest index') ||
              promptLowerCase.includes('add index') ||
              promptLowerCase.includes('alter table') ||
              promptLowerCase.includes('create table') ||
              promptLowerCase.includes('drop index') ||
              promptLowerCase.includes('optimize') ||
              promptLowerCase.includes('performance') ||
              promptLowerCase.includes('slow query');
            
            // For SQL generation or error fixing, use the original schema-based approach
            const schema = queryError 
              ? z.object({ 
                  sql: z.string()
                    .min(1)
                    .describe('The complete SQL response including comments explaining what was wrong and the fixed query. Must include: 1) Comments (lines starting with --) explaining the error, 2) The original broken query commented out (every line with --), 3) A blank line, 4) The fixed query')
                })
              : (isDDLOperation 
                ? z.object({ 
                    sql: z.string()
                      .min(1)
                      .describe('DDL/Index operation response. Provide: 1) Comments explaining the recommendation, 2) Executable DDL statements (CREATE INDEX, ALTER TABLE, etc.). Use the table and column names from "Available Tables" and "Available Columns". For index suggestions, analyze the table structure and suggest appropriate indexes based on common query patterns.')
                  })
                : z.object({ 
                    sql: z.string()
                      .min(1)
                      .describe('A valid SQL query. CRITICAL: You MUST verify that every table and column you use exists in the "Available Tables" and "Available Columns" sections provided in the prompt. Do NOT invent or assume any table or column names. Only use tables and columns that are explicitly listed.')
                  })
              );
            
            try { 
              if (queryError) {
                console.log('[bks-ai-shell] Using schema that allows comments for error fixing'); 
              }
            } catch {}
            
            if (!bypassAI) {
              const obj = await provider.generateObject<{ sql: string }>({
                modelId: model.id as any,
                schema: schema,
                prompt: isSlashCommand ? (expertDBAPersona + '\n\n' + commandPrompt) : (expertDBAPersona + '\n\n' + instruction + '\n\nUser request:\n' + String(prompt || '')),
                providerId: model.provider as any,
                queryText: currentQuery || undefined,
              });
              sql = (obj?.object as any)?.sql || '';
            }
            // If bypassAI is true, sql is already set from the pre-generated script
          }
        } else {
          console.warn('[bks-ai-shell] No active model selected; cannot call LLM');
        }
      } catch (e) {
        console.error('[bks-ai-shell] Inline LLM error:', e);
        
        // Check if this is a credit error and notify the user
        const errorMsg = e instanceof Error ? e.message : String(e);
        if (errorMsg.includes('No Credits Available') || errorMsg.includes('Low Credits Warning')) {
          // Show error notification to user
          console.log('[bks-ai-shell] Showing credit error notification:', errorMsg);
          try {
            notify("pluginError", {
              name: "Credit Error",
              message: errorMsg,
            });
            console.log('[bks-ai-shell] Successfully showed error notification');
          } catch (notifyErr) {
            console.error('[bks-ai-shell] Failed to show notification:', notifyErr);
          }
          
          // Check if this is analysis mode and send appropriate completion message
          const isAnalysisMode = (aiMode === 'analysis');
          if (isAnalysisMode) {
            // For analysis mode, send error in proper format with all required sections
            const formattedError = `AI_FINAL_BEGIN

1) Original Query
\`\`\`sql
${context?.currentQuery || '-- Query not available'}
\`\`\`

2) Plan Summary
${errorMsg}

3) Root Causes
Unable to analyze due to insufficient credits.

4) Index Recommendations
No recommendations available.

5) Query Rewrites
No rewrites available.

6) Predicate Analysis
No analysis available.

7) Estimated Impact
Unable to estimate impact.

8) Index DDL
No DDL statements available.

AI_FINAL_END`;
            try {
              console.log('[bks-ai-shell] posting analysis-final-text with credit error (length)', formattedError?.length || 0);
              window.parent?.postMessage({ 
                type: 'bks-ai/analysis-final-text', 
                requestId, 
                text: formattedError 
              }, '*');
            } catch {}
          } else {
            // For code mode, send empty insert-sql to complete flow
            try {
              console.log('[bks-ai-shell] Posting empty insert-sql to complete flow');
              window.parent?.postMessage({ 
                type: 'bks-ai/inline-code/insert-sql', 
                requestId, 
                sql: '', 
                run: false, 
                replaceMode: false 
              }, '*');
            } catch {}
          }
          
          // Don't proceed with empty SQL insertion
          return;
        }
      }
      
      const isAnalysisMode = (aiMode === 'analysis');
      if (isAnalysisMode) {
        try { console.log('[bks-ai-shell] analysis mode: generating text response for staged analysis'); } catch {}
        try {
          const chat = useChatStore();
          let model = chat?.model;
          if (!model || !model.id) {
            try { await chat.initialize(); model = chat.model; } catch (e) { console.warn('[bks-ai-shell] chat.initialize() failed', e); }
          }
          if (model && model.provider && model.id) {
            const provider = await createProvider(model.provider as any);
            
            // Use generateText instead of generateObject to allow free-form responses with AI_REQUEST_BEGIN/END or AI_FINAL_BEGIN/END
            const enhancedPrompt = `${String(prompt || '')}

CRITICAL FORMATTING REQUIREMENT:
- If you need additional data (Stage 2), respond with:
  AI_REQUEST_BEGIN
  {"need":["VIEW_DEFINITION"], "why":"reason", "tables":["schema.table"]}
  AI_REQUEST_END

- If you have all data needed (final response), respond with:
  AI_FINAL_BEGIN
  [Your complete analysis with all 8 sections]
  AI_FINAL_END

Your final response must include all 8 sections:
1) Original Query
2) Plan Summary  
3) Root Causes
4) Index Recommendations
5) Query Rewrites
6) Predicate Analysis
7) Estimated Impact
8) Last-Resort Options`;

            const result = await provider.generateText({ 
              modelId: model.id as any, 
              prompt: enhancedPrompt,
              providerId: model.provider as any,
              queryText: currentQuery || undefined
            });
            let text = result?.text || '';

            // Hard enforce AI_FINAL wrapper and sections client-side to guarantee insertion
            try {
              // Check for correct markers
              let hasBegin = /AI_FINAL_BEGIN/.test(text);
              let hasEnd = /AI_FINAL_END/.test(text);
              
              // Check if AI is requesting additional data (Stage 2)
              const hasRequestBegin = /AI_REQUEST_BEGIN/.test(text);
              const hasRequestEnd = /AI_REQUEST_END/.test(text);
              
              if (!hasBegin && hasRequestBegin && hasRequestEnd) {
                console.log('[bks-ai-shell] AI requesting additional data in Stage 2');
                // Extract the JSON request between AI_REQUEST_BEGIN and AI_REQUEST_END
                const beginIdx = text.indexOf('AI_REQUEST_BEGIN');
                const endIdx = text.indexOf('AI_REQUEST_END');
                if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
                  const jsonStr = text.substring(beginIdx + 'AI_REQUEST_BEGIN'.length, endIdx).trim();
                  try {
                    const req = JSON.parse(jsonStr);
                    console.log('[bks-ai-shell] Parsed AI request:', req);
                    // Emit the request to the parent window (Toolbar.vue will handle it)
                    window.parent?.postMessage({ 
                      type: 'bks-ai/analysis-need-sections', 
                      requestId, 
                      request: req 
                    }, '*');
                    console.log('[bks-ai-shell] Emitted aiAnalysisNeedSections event to parent');
                    return; // Don't proceed with AI_FINAL processing
                  } catch (e) {
                    console.error('[bks-ai-shell] Failed to parse AI_REQUEST JSON:', e);
                  }
                }
              }
              
              const required = [
                '1) Original Query',
                '2) Plan Summary',
                '3) Root Causes',
                '4) Index Recommendations',
                '5) Query Rewrites',
                '6) Predicate Analysis',
                '7) Estimated Impact',
                '8) Last-Resort Options'
              ];

              // Backfill Original Query from active tab when needed
              let originalQuery = '';
              try { originalQuery = await getQueryText(); } catch {}
              if (!originalQuery || !originalQuery.trim()) originalQuery = '-- Not available';

              const ensureWrapped = (body: string) => `AI_FINAL_BEGIN\n${body}\nAI_FINAL_END`;

              let finalBody = '';
              // If no markers at all, AI failed - don't insert skeleton, just log error
              if (!hasBegin || !hasEnd) {
                console.error('[bks-ai-shell] AI did not return AI_FINAL markers - likely rate limit or timeout');
                console.log('[bks-ai-shell] Raw AI response (first 500 chars):', text.substring(0, 500));
                // Don't send anything - let the host handle the error
                return;
              } else {
                // Extract body between markers - send as-is without auto-backfill
                // The host (Toolbar.vue) will validate and handle missing sections
                let body = text.replace(/^[\s\S]*?AI_FINAL_BEGIN\s*/m, '').replace(/\s*AI_FINAL_END[\s\S]*$/m, '').trim();
                
                // Only backfill Original Query if completely missing
                const hasOriginalQuery = /(\n|^)\s*1[\).]\s*Original\s+Query/i.test(body);
                if (!hasOriginalQuery && originalQuery && originalQuery.trim() && originalQuery !== '-- Not available') {
                  body = `1) Original Query\n\`\`\`sql\n${originalQuery}\n\`\`\`\n\n` + body;
                }
                
                finalBody = body;
              }

              // Wrap into AI_FINAL markers
              let finalText = ensureWrapped(finalBody);

              // Post final text back to host and return
              try { console.log('[bks-ai-shell] posting analysis-final-text to parent (length)', finalText?.length || 0) } catch {}
              try { window.parent?.postMessage({ type: 'bks-ai/analysis-final-text', requestId, text: finalText }, '*') } catch {}
            } catch (e) {
              console.error('[bks-ai-shell] Failed to enforce AI_FINAL format', e);
            }
          }
        } catch (e) {
          console.error('[bks-ai-shell] Analysis mode LLM error:', e);
          
          // Send user-friendly error message to host
          const errorMsg = String((e as any)?.message || e || 'Unknown error');
          let userMessage = '';
          
          if (errorMsg.includes('No Credits Available') || errorMsg.includes('Low Credits Warning')) {
            // Pass through credit errors as-is (they're already user-friendly)
            userMessage = errorMsg;
            // Also show notification popup for credit errors
            console.log('[bks-ai-shell] Showing credit error notification for analysis mode:', errorMsg);
            try {
              notify("pluginError", {
                name: "Credit Error",
                message: errorMsg,
              });
              console.log('[bks-ai-shell] Successfully showed analysis mode error notification');
            } catch (notifyErr) {
              console.error('[bks-ai-shell] Failed to show analysis notification:', notifyErr);
            }
          } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('502') || errorMsg.includes('CORS')) {
            userMessage = '⚠️ OpenAI API Connection Failed\n\nPossible causes:\n• OpenAI servers are temporarily unavailable (502 Bad Gateway)\n• Network/firewall blocking the request\n• API rate limit exceeded\n\nPlease:\n1. Wait 30-60 seconds and try again\n2. Check https://status.openai.com/ for service status\n3. Verify your API key and quota';
          } else if (errorMsg.includes('Rate limit') || errorMsg.includes('429')) {
            userMessage = '⚠️ OpenAI Rate Limit Exceeded\n\nYou have exceeded your API rate limit.\n\nPlease:\n1. Wait 30-60 seconds before retrying\n2. Check your OpenAI usage dashboard\n3. Consider upgrading your plan if needed';
          } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
            userMessage = '⚠️ OpenAI API Authentication Failed\n\nYour API key may be invalid or expired.\n\nPlease:\n1. Verify your API key in settings\n2. Check if the key has proper permissions\n3. Generate a new key if needed';
          } else {
            userMessage = `⚠️ AI Analysis Failed\n\nError: ${errorMsg}\n\nPlease try again or check the console for details.`;
          }
          
          // Send error wrapped in AI_FINAL markers so the status completes
          const finalErrorText = `AI_FINAL_BEGIN\n${userMessage}\nAI_FINAL_END`;
          try {
            console.log('[bks-ai-shell] posting analysis-final-text with error (length)', finalErrorText?.length || 0);
            window.parent?.postMessage({ 
              type: 'bks-ai/analysis-final-text', 
              requestId, 
              text: finalErrorText 
            }, '*');
          } catch {}
        }
        return;
      }

      if (!sql || !String(sql).trim()) {
        console.warn('[bks-ai-shell] LLM returned empty SQL; inserting diagnostic comment');
        sql = '-- Inline AI did not return SQL for this request.';
      }

      try { sql = sanitizeMssqlSql(String(sql || '')); } catch (_) {}

      try { console.log('[bks-ai-shell] posting insert-sql reply to parent', { requestId, hasSql: !!sql, run: !!runAfterInsert, replaceMode: !!shouldReplace }); } catch {}
      try { window.parent?.postMessage({ type: 'bks-ai/inline-code/insert-sql', requestId, sql, run: !!runAfterInsert, replaceMode: !!shouldReplace }, '*'); } catch {}
    });
  }
} catch (e) {
  console.error('[bks-ai-shell] Failed to register inline AI bridge', e);
}
