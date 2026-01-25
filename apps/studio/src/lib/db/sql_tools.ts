import _ from 'lodash'
import { identify, Options } from 'sql-query-identifier'
import { EntityFilter } from '@/store/models'
import { RoutineTypeNames } from "./models"
import { format } from 'sql-formatter'
import { Dialect, FormatterDialect } from '@/shared/lib/dialects/models'
import { ParamItems } from 'sql-formatter/lib/src/formatter/Params'

export function splitQueries(queryText: string, dialect) {
  if(_.isEmpty(queryText.trim())) {
    return []
  }
  const result = identify(queryText, { strict: false, dialect })
  return result
}

/**
 * Split SQL Server query text by GO batch separator.
 * GO is a batch terminator recognized by SSMS and other SQL Server tools,
 * but not by the SQL Server engine itself. We need to split and execute separately.
 * @param queryText The full query text potentially containing GO statements
 * @returns Array of query batches (strings)
 */
export function detectGoPresence(queryText: string): boolean {
  if (!queryText) return false
  const normalized = queryText.replace(/\r\n/g, '\n')
  // detect any line starting with GO (case-insensitive). This intentionally
  // allows trailing text so we can be tolerant with user input like "GO EXEC ...".
  return /^\s*go\b/im.test(normalized)
}

export function splitSqlServerGoBatches(queryText: string): string[] {
  if (!queryText || !queryText.trim()) {
    return []
  }

  // Normalize line endings and split into lines
  const lines = queryText.replace(/\r\n/g, '\n').split('\n')
  const batches: string[] = []
  let current: string[] = []

  const flush = () => {
    const text = current.join('\n').trim()
    if (text) batches.push(text)
    current = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^\s*go\b\s*(\d+)?(.*)$/i.exec(line)
    if (!m) {
      current.push(line)
      continue
    }

    // Found a GO line (tolerate trailing text on the same line)
    // 1) finish current batch
    flush()

    // 2) If GO has a numeric repeat (e.g., GO 5), we simply start next batch boundary.
    // In SSMS GO 5 repeats the previous batch N times; implementing that fully is out of scope
    // here, so we just treat it as a normal separator.

    // 3) If there is trailing SQL after GO on the same line, start a new batch with that trailing
    //    content (trim leading whitespace to avoid accidental concatenation).
    const trailing = (m[2] || '').trim()
    if (trailing) {
      // If trailing text exists, it becomes the first line of the next batch
      current.push(trailing)
    }
  }

  // push the last batch
  flush()

  return batches
}

// can only have positional params OR non-positional
export function canDeparameterize(params: string[]) {
  return !(params.includes('?') && params.some((val) => val != '?'));
}

export function convertParamsForReplacement(placeholders: string[], values: string[]): ParamItems | string[] {
  if (placeholders.includes('?')) {
    return values;
  } else {
    // TODO (@day): this might not work with quoted params
    // this will need to be more complex if we allow truly custom params
    return placeholders.reduce((obj, val, index) => {
      obj[val.slice(1)] = values[index];
      return obj;
    }, {});
  }
}

export function deparameterizeQuery(queryText: string, dialect: Dialect, params: ParamItems | string[], paramTypes: Options["paramTypes"]) {
  // for if we want custom params in the future
  // paramTypes.custom = paramTypes.custom.map((reg: string) => ({ regex: reg }));
  try {
    const result = format(queryText, {
      language: FormatterDialect(dialect),
      paramTypes,
      params
    });
    return result;
  } catch (_) {
    return queryText;
  }
}

export function entityFilter(rawTables: any[], allFilters: EntityFilter) {
  const tables = rawTables.filter((table) => {
    return (table.entityType === 'table' && allFilters.showTables &&
      ((table.parenttype != 'p' && !allFilters.showPartitions) || allFilters.showPartitions)) ||
      (table.entityType === 'view' && allFilters.showViews) ||
      (table.entityType === 'materialized-view' && allFilters.showViews) ||
      (Object.keys(RoutineTypeNames).includes(table.type) && allFilters.showRoutines)
  })

  const { filterQuery } = allFilters
  if (!filterQuery) {
    return tables
  }
  const startsWithFilter = _(tables)
    .filter((item) => _.startsWith(item.name.toLowerCase(), filterQuery.toLowerCase()))
    .value()
  const containsFilter = _(tables)
    .difference(startsWithFilter)
    .filter((item) => item.name.toLowerCase().includes(filterQuery.toLowerCase()))
    .value()
  return _.concat(startsWithFilter, containsFilter)
}

// a function that takes in a string and a dialect,
// if the string is determined to be most likely a query and it is quoted, we remove the quotes,
// else we just return the trimmed query
export function removeQueryQuotes(possibleQuery: string, dialect: any): string {
  // ensure there's no leading/trailing whitespace before we make our checks
  possibleQuery = possibleQuery.trim();

  const quotes = ["'", '"', '`'];
  const first = possibleQuery[0], last = possibleQuery[possibleQuery.length - 1];
  const isQuoted = quotes.includes(first) && quotes.includes(last) && first === last;
  const unquotedQuery = possibleQuery.slice(1, possibleQuery.length - 1);

  // if the query is quoted and we can identify at least one valid sql statement, we'll unquote it.
  if (isQuoted && identify(unquotedQuery, { strict: false, dialect })?.some((res) => res.type != 'UNKNOWN')) {
    return unquotedQuery;
  }

  return possibleQuery;
}

export function isTextSelected(
  textStart: number,
  textEnd: number,
  selectionStart: number,
  selectionEnd: number
) {
  const cursorMin = Math.min(selectionStart, selectionEnd);
  const cursorMax = Math.max(selectionStart, selectionEnd);
  const queryMin = Math.min(textStart, textEnd);
  const queryMax = Math.max(textStart, textEnd);
  if (
    (cursorMin >= queryMin && cursorMin <= queryMax) ||
    (cursorMax > queryMin && cursorMax <= queryMax) ||
    (cursorMin <= queryMin && cursorMax >= queryMax)
  ) {
    return true;
  }
  return false;
}

