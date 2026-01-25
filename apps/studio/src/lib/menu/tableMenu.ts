import {
  CellComponent,
  ColumnComponent,
  MenuObject,
  RangeComponent,
  Tabulator,
} from "tabulator-tables";
import { markdownTable } from "markdown-table";
import { ElectronPlugin } from "@/lib/NativeWrapper";
import Papa from "papaparse";
import { stringifyRangeData, rowHeaderField, isNumericDataType } from "@/common/utils";
import { escapeHtml } from "@shared/lib/tabulator";
import _ from "lodash";
// ?? not sure about this but :shrug:
import Vue from "vue";
import { AppEvent } from "@/common/AppEvent";

// Helper function to detect query type and choose appropriate plugin command
function detectQueryTypeAndCommand(query?: string | any): { analyzeCommand: string; fixCommand: string; isBlitz: boolean; isDMV: boolean } {
  console.log(`[detectQueryTypeAndCommand] Raw query parameter:`, query);
  console.log(`[detectQueryTypeAndCommand] Query type:`, typeof query);
  
  if (!query || typeof query !== 'string') {
    console.warn(`[detectQueryTypeAndCommand] Query is not a valid string, using defaults`);
    return { analyzeCommand: '/analyze results', fixCommand: 'Fix issues in active tab results', isBlitz: false, isDMV: false };
  }
  
  const queryLower = query.toLowerCase();
  console.log(`[detectQueryTypeAndCommand] Query lowercase:`, queryLower);
  
  const blitzCommands: Record<string, { analyze: string; fix: string }> = {
    'sp_blitzcache': { analyze: '/analyze blitzcache', fix: 'For sp_BlitzCache' },
    'sp_blitzlock': { analyze: '/analyze blitzlock', fix: 'For sp_BlitzLock' },
    'sp_blitzfirst': { analyze: '/analyze blitzfirst', fix: 'For sp_BlitzFirst' },
    'sp_blitzindex': { analyze: '/analyze blitzindex', fix: 'For sp_BlitzIndex' },
    'sp_blitzwho': { analyze: '/analyze blitzwho', fix: 'Fix issues in active tab results' },
    'sp_blitz': { analyze: '/analyze blitz', fix: 'For sp_Blitz' },
    'sp_whoisactive': { analyze: '/whoisactive', fix: 'For sp_WhoIsActive' }
  };
  let analyzeCommand = '/analyze results';
  let fixCommand = 'Fix issues in active tab results';
  let isBlitz = false;
  for (const [proc, cmds] of Object.entries(blitzCommands)) {
    if (queryLower.includes(proc)) {
      console.log(`[detectQueryTypeAndCommand] MATCHED procedure: ${proc}`);
      analyzeCommand = cmds.analyze;
      fixCommand = cmds.fix;
      isBlitz = true;
      break;
    }
  }
  const dmvPatterns = ['sys.dm_', 'sys.databases', 'sys.tables', 'sys.indexes', 'sys.columns', 'sys.objects', 'sys.partitions', 'sys.allocation_units'];
  const isDMV = dmvPatterns.some(pattern => queryLower.includes(pattern));

  console.log(`[detectQueryTypeAndCommand] Final Analyze Command: ${analyzeCommand}`);
  console.log(`[detectQueryTypeAndCommand] Final Fix Command: ${fixCommand}`);
  console.log(`[detectQueryTypeAndCommand] Is Blitz: ${isBlitz}`);
  console.log(`[detectQueryTypeAndCommand] Is DMV: ${isDMV}`);

  return { analyzeCommand, fixCommand, isBlitz, isDMV };
}

type ColumnMenuItem = MenuObject<ColumnComponent>;
type RangeData = Record<string, any>[];
interface ExtractedData {
  data: RangeData;
  sources: RangeComponent[];
}

export const sortAscending: ColumnMenuItem = {
  label: createMenuItem("Sort ascending"),
  action: (_, column) => column.getTable().setSort(column.getField(), "asc"),
};

export const sortDescending: ColumnMenuItem = {
  label: createMenuItem("Sort descending"),
  action: (_, column) => column.getTable().setSort(column.getField(), "desc"),
};

export const hideColumn: ColumnMenuItem = {
  label: createMenuItem("Hide column"),
  action: (_, column) => column.hide(),
};

export const resizeAllColumnsToMatch: ColumnMenuItem = {
  label: createMenuItem("Resize all columns to match"),
  action: (_, column) => {
    try {
      column.getTable().blockRedraw();
      const columns = column.getTable().getColumns();
      columns.forEach((col) => {
        if (col.getField() !== rowHeaderField) {
          col.setWidth(column.getWidth());
        }
      });
    } catch (error) {
      console.error(error);
    } finally {
      column.getTable().restoreRedraw();
    }
  },
};

export const resizeAllColumnsToFitContent: ColumnMenuItem = {
  label: createMenuItem("Resize all columns to fit content"),
  action: (_, column) => resizeAllColumnsToFitContentAction(column.getTable()),
};

export const resizeAllColumnsToFixedWidth: ColumnMenuItem = {
  label: createMenuItem("Resize all columns to fixed width"),
  action: (_, column) => {
    try {
      column.getTable().blockRedraw();
      const columns = column.getTable().getColumns();
      columns.forEach((col) => {
        if (col.getField() !== rowHeaderField) {
          col.setWidth(200);
        }
      });
    } catch (error) {
      console.error(error);
    } finally {
      column.getTable().restoreRedraw();
    }
  },
};

export function resizeAllColumnsToFitContentAction(table: Tabulator) {
  try {
    const columns = table.getColumns();
    columns.forEach((col) => {
      if (col.getField() !== rowHeaderField) {
        col.setWidth(true);
      }
    });
  } catch (error) {
    console.error(error);
  } finally {
    table.restoreRedraw();
  }
}

export const commonColumnMenu = [
  sortAscending,
  sortDescending,
  { separator: true },
  resizeAllColumnsToMatch,
  resizeAllColumnsToFitContent,
  resizeAllColumnsToFixedWidth,
];

export function createMenuItem(label: string, shortcut = "", ultimate = false) {
  label = `<x-label>${escapeHtml(label)}</x-label>`;
  if (shortcut) shortcut = `<x-shortcut value="${escapeHtml(shortcut)}" />`;
  const ultimateIcon = ultimate ? `<i class="material-icons menu-icon">stars</i>` : '';
  return `<x-menuitem>${label}${shortcut}${ultimateIcon}</x-menuitem>`;
}

export async function copyRanges(options: {
  ranges: RangeComponent[];
  type: "plain" | "tsv" | "json" | "markdown" | "columnName";
}): Promise<void>;
export async function copyRanges(options: {
  ranges: RangeComponent[];
  type: "sql" | "asIn";
  table: string;
  schema?: string;
}): Promise<void>;
export async function copyRanges(options: {
  ranges: RangeComponent[];
  type: "plain" | "tsv" | "json" | "markdown" | "sql" | "columnName" | "asIn";
  table?: string;
  schema?: string;
}) {
  let text = "";

  const extractedData = extractRanges(options.ranges);
  const rangeData = extractedData.data;
  const stringifiedRangeData = stringifyRangeData(rangeData);

  switch (options.type) {
    case "plain": {
      if (countCellsFromData(rangeData) === 1) {
        const key = Object.keys(stringifiedRangeData[0])[0];
        text = stringifiedRangeData[0][key];
      } else {
        text = Papa.unparse(stringifiedRangeData, {
          header: false,
          delimiter: "\t",
          quotes: false,
          escapeFormulae: false,
        });
      }
      break;
    }
    case "tsv":
      text = Papa.unparse(stringifiedRangeData, {
        header: false,
        delimiter: "\t",
        quotes: true,
        escapeFormulae: true,
      });
      break;
    case "json":
      text = JSON.stringify(rangeData);
      break;
    case "markdown": {
      const headers = Object.keys(stringifiedRangeData[0]);
      text = markdownTable([
        headers,
        ...stringifiedRangeData.map((item) => Object.values(item)),
      ]);
      break;
    }
    case "asIn": {
      const [colDataType] = Object.keys(rangeData[0])
      const columns = await Vue.prototype.$util.send("conn/listTableColumns", {
        table: options.table,
        schema: options.schema
      });
      const dataType = columns.find(c => c.columnName === colDataType)?.dataType
      const isNumericType = isNumericDataType(dataType)
      const textArr = rangeData.map(rd => {
        const [data] = Object.values(rd)
        return isNumericType ? data : `'${data}'`
      })
      text = `(\n${textArr.join(',\n')}\n)`
      break
    }
    case "sql":
      text = await Vue.prototype.$util.send("conn/getInsertQuery", {
        tableInsert: {
          table: options.table,
          schema: options.schema,
          data: rangeData,
        },
      });
      break;
    case "columnName":
      text = Object.keys(extractedData.data[0]).join(" ");
      break;
  }
  ElectronPlugin.clipboard.writeText(text);
  extractedData.sources.forEach((range) => {
    (range.getElement() as HTMLElement).classList.add("copied");
  });
}

function extractRanges(ranges: RangeComponent[]): ExtractedData {
  if (ranges.length === 0) return;

  if (ranges.length === 1) {
    const rangeData = ranges[0].getData() as RangeData;
    // Replace column identifiers with column titles
    const columns = ranges[0].getColumns();
    const mappedData = mapColumnIdsToTitles(rangeData, columns);

    return {
      data: mappedData,
      sources: [ranges[0]],
    };
  }

  let sameColumns = true;
  let sameRows = true;
  const firstCols = ranges[0].getColumns();
  const firstRows = ranges[0].getRows();

  for (let i = 1; i < ranges.length; i++) {
    if (!_.isMatch(firstCols, ranges[i].getColumns())) {
      sameColumns = false;
    }

    if (!_.isMatch(firstRows, ranges[i].getRows())) {
      sameRows = false;
    }

    if (!sameColumns && !sameRows) break;
  }

  if (sameColumns) {
    const allData = ranges.reduce((data, range) => data.concat(range.getData()), []);
    // Replace column identifiers with column titles
    const columns = ranges[0].getColumns();
    const mappedData = mapColumnIdsToTitles(allData, columns);

    return {
      data: mappedData,
      sources: ranges,
    };
  }

  if (sameRows) {
    const sorted = _.sortBy(ranges, (range) => range.getLeftEdge());
    const rows = sorted[0].getData() as RangeData;
    for (let i = 1; i < sorted.length; i++) {
      const data = sorted[i].getData() as RangeData;
      for (let j = 0; j < data.length; j++) {
        _.forEach(data[j], (value, key) => {
          rows[j][key] = value;
        });
      }
    }

    // Replace column identifiers with column titles
    const allColumns = sorted.reduce((cols, range) => cols.concat(range.getColumns()), []);
    const uniqueColumns = _.uniqBy(allColumns, col => col.getField());
    const mappedData = mapColumnIdsToTitles(rows, uniqueColumns);

    return {
      data: mappedData,
      sources: ranges,
    };
  }

  const source = _.first(ranges);
  const rangeData = source.getData() as RangeData;

  // Replace column identifiers with column titles
  const columns = source.getColumns();
  const mappedData = mapColumnIdsToTitles(rangeData, columns);

  return {
    data: mappedData,
    sources: [source],
  };
}

function countCellsFromData(data: RangeData) {
  return data.reduce((acc, row) => acc + Object.keys(row).length, 0);
}

export function pasteRange(range: RangeComponent) {
  const text = ElectronPlugin.clipboard.readText();
  if (!text) return;

  const parsedText = Papa.parse(text, {
    header: false,
    delimiter: "\t",
  });

  if (parsedText.errors.length > 0) {
    const cell = range.getCells()[0][0];
    setCellValue(cell, text);
  } else {
    const table = range.getRows()[0].getTable();
    const rows = table.getRows("active").slice(range.getTopEdge());
    const columns = table
      .getColumns(false)
      .filter((col) => col.isVisible())
      .slice(range.getLeftEdge());
    const cells: CellComponent[][] = rows.map((row) => {
      const arr = [];
      row.getCells().forEach((cell) => {
        if (columns.includes(cell.getColumn())) {
          arr.push(cell);
        }
      });
      return arr;
    });

    parsedText.data.forEach((row: string[], rowIdx) => {
      row.forEach((text, colIdx) => {
        const cell = cells[rowIdx]?.[colIdx];
        if (!cell) return;
        setCellValue(cell, text);
      });
    });
  }
}

export function setCellValue(cell: CellComponent, value: string) {
  const editableFunc = cell.getColumn().getDefinition().editable;
  const editable =
    typeof editableFunc === "function" ? editableFunc(cell) : editableFunc;
  if (editable) cell.setValue(value);
}

// Helper function to map column IDs to column titles
function mapColumnIdsToTitles(data: RangeData, columns: ColumnComponent[]): RangeData {
  if (!data || !data.length || !columns || !columns.length) return data;

  const colIdToTitleMap = new Map();
  columns.forEach(col => {
    const field = col.getField();
    if (field === rowHeaderField) return; // Skip row header
    const title = col.getDefinition().title;
    if (title) colIdToTitleMap.set(field, title);
  });

  return data.map(row => {
    const newRow = {};
    Object.entries(row).forEach(([key, value]) => {
      const newKey = colIdToTitleMap.get(key) || key;
      newRow[newKey] = value;
    });
    return newRow;
  });
}

export function copyActionsMenu(options: {
  ranges: RangeComponent[];
  table?: string;
  schema?: string;
  vueInstance?: any;
  query?: string;
  hasExecutionPlan?: boolean;
}) {
  const { ranges, table, schema, vueInstance, query, hasExecutionPlan } = options;
  const columnCount = ranges[0].getColumns().length
  const copyActions = [
    {
      label: createMenuItem("Copy", "Control+C"),
      action: () => copyRanges({ ranges, type: "plain" }),
    },
    {
      label: createMenuItem("Copy Column Name"),
      action: () => copyRanges({ ranges, type: "columnName" }),
    },
    {
      label: createMenuItem("Copy as TSV for Excel"),
      action: () => copyRanges({ ranges, type: "tsv" }),
    },
    {
      label: createMenuItem("Copy as JSON"),
      action: () => copyRanges({ ranges, type: "json" }),
    },
    {
      label: createMenuItem("Copy as Markdown"),
      action: () => copyRanges({ ranges, type: "markdown" }),
    },
    {
      label: createMenuItem("Copy as SQL"),
      action: () =>
        copyRanges({
          ranges,
          type: "sql",
          table,
          schema,
        }),
    },
  ];

  if (columnCount === 1) {
    copyActions.push({
      label: createMenuItem("Copy for IN statement"),
      action: () => copyRanges({ ranges, type: "asIn", table, schema }),
    })
  }

  // Add AI options only if vueInstance is provided
  if (vueInstance) {
    copyActions.push(
      { separator: true } as any,
      {
        label: createMenuItem("Analyse with AI"),
        action: async () => {
          // Detect query type and choose appropriate command
          const queryString = typeof query === 'string' ? query : '';
          const detection = detectQueryTypeAndCommand(queryString);
          
          console.log('[Analyse with AI] Query:', queryString);
          console.log('[Analyse with AI] Detection:', detection);
          console.log('[Analyse with AI] Suggested command:', detection.analyzeCommand);
          
          // Open AI sidebar
          vueInstance.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell');
          vueInstance.$root.$emit(AppEvent.toggleSecondarySidebar, true);
          
          // Send command to AI chat window
          vueInstance.$nextTick(() => {
            try {
              // Find the AI plugin iframe
              const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
              const aiFrame = frames.find(f => {
                const src = (f.getAttribute('src') || f.src || '').toString();
                return src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/');
              });
              
              if (aiFrame && aiFrame.contentWindow) {
                console.log('[Analyse with AI] Sending command to AI chat:', detection.analyzeCommand);
                
                // Send message to plugin to set input and submit
                aiFrame.contentWindow.postMessage({
                  type: 'set-and-submit-input',
                  text: detection.analyzeCommand
                }, '*');
                
                if (vueInstance.$noty) {
                  vueInstance.$noty.success(`Analyzing with command: ${detection.analyzeCommand}`, { timeout: 3000 });
                }
              } else {
                console.warn('[Analyse with AI] AI plugin iframe not found');
                if (vueInstance.$noty) {
                  vueInstance.$noty.info(`AI Mode opened. Type: ${detection.analyzeCommand}`, { timeout: 5000 });
                }
              }
            } catch (err) {
              console.error('[Analyse with AI] Error:', err);
            }
          });
        },
      },
      {
        label: createMenuItem("Fix with AI"),
        action: async () => {
          // Detect query type
          const queryString = typeof query === 'string' ? query : '';
          const detection = detectQueryTypeAndCommand(queryString);
          
          // Get selected row numbers
          const selectedRows = ranges[0].getRows();
          const rowNumbers = selectedRows.map(row => {
            const rowData = row.getData();
            // Try to get row number from the data (usually has a row number field)
            return rowData[rowHeaderField] || row.getPosition();
          });
          
          console.log('[Fix with AI] Query:', queryString);
          console.log('[Fix with AI] Detection:', detection);
          console.log('[Fix with AI] Selected rows:', rowNumbers);
          
          // Build the command with row number parameter
          let commandPrompt = detection.fixCommand;
          
          // Add row number parameter based on selection
          if (rowNumbers.length === 1) {
            // Single row selected
            commandPrompt += ` rowNumber=${rowNumbers[0]} deepDive`;
          } else if (rowNumbers.length > 1) {
            // Check if user selected all rows in the table
            const table = ranges[0].getRows()[0].getTable();
            const totalRows = table.getRows().length;
            
            if (rowNumbers.length === totalRows) {
              // All rows selected - use allRows
              commandPrompt += ` allRows deepDive`;
            } else {
              // Multiple specific rows selected - list them
              commandPrompt += ` rowNumber=${rowNumbers.join(',')} deepDive`;
            }
          }
          
          console.log('[Fix with AI] Suggested command:', commandPrompt);
          
          // Open AI sidebar
          vueInstance.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell');
          vueInstance.$root.$emit(AppEvent.toggleSecondarySidebar, true);
          
          // Send command to AI chat window
          vueInstance.$nextTick(() => {
            try {
              // Find the AI plugin iframe
              const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
              const aiFrame = frames.find(f => {
                const src = (f.getAttribute('src') || f.src || '').toString();
                return src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/');
              });
              
              if (aiFrame && aiFrame.contentWindow) {
                console.log('[Fix with AI] Sending command to AI chat:', commandPrompt);
                
                // Send message to plugin to set input and submit
                aiFrame.contentWindow.postMessage({
                  type: 'set-and-submit-input',
                  text: commandPrompt
                }, '*');
                
                if (vueInstance.$noty) {
                  vueInstance.$noty.success(`Fixing with command: ${commandPrompt}`, { timeout: 3000 });
                }
              } else {
                console.warn('[Fix with AI] AI plugin iframe not found');
                if (vueInstance.$noty) {
                  vueInstance.$noty.info(`AI Mode opened. Type: ${commandPrompt}`, { timeout: 5000 });
                }
              }
            } catch (err) {
              console.error('[Fix with AI] Error:', err);
            }
          });
        },
      }
    );
    
    // Only add "Analyze execution plan" if execution plan is available
    if (hasExecutionPlan) {
      copyActions.push({
        label: createMenuItem("Analyze execution plan"),
        action: async () => {
          const commandPrompt = 'Analyze execution plan';
          
          console.log('[Analyze execution plan] Sending command:', commandPrompt);
          
          // Open AI sidebar
          vueInstance.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell');
          vueInstance.$root.$emit(AppEvent.toggleSecondarySidebar, true);
          
          // Send command to AI chat window
          vueInstance.$nextTick(() => {
            try {
              // Find the AI plugin iframe
              const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
              const aiFrame = frames.find(f => {
                const src = (f.getAttribute('src') || f.src || '').toString();
                return src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/');
              });
              
              if (aiFrame && aiFrame.contentWindow) {
                console.log('[Analyze execution plan] Sending command to AI chat:', commandPrompt);
                
                // Send message to plugin to set input and submit
                aiFrame.contentWindow.postMessage({
                  type: 'set-and-submit-input',
                  text: commandPrompt
                }, '*');
                
                if (vueInstance.$noty) {
                  vueInstance.$noty.success(`Analyzing execution plan`, { timeout: 3000 });
                }
              } else {
                console.warn('[Analyze execution plan] AI plugin iframe not found');
                if (vueInstance.$noty) {
                  vueInstance.$noty.info(`AI Mode opened. Type: ${commandPrompt}`, { timeout: 5000 });
                }
              }
            } catch (err) {
              console.error('[Analyze execution plan] Error:', err);
            }
          });
        },
      });
    }
  }

  return copyActions
}

export function pasteActionsMenu(range: RangeComponent) {
  return [
    {
      label: createMenuItem("Paste", "Control+V"),
      action: () => pasteRange(range),
    },
  ];
}
