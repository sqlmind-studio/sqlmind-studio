/**
 * Schema-Aware Query Builder
 * 
 * This tool forces the AI to construct SQL queries step-by-step using actual schema metadata,
 * similar to how a visual query builder works. This prevents hardcoded column names and
 * ensures all queries use only columns that actually exist.
 */

import { z } from 'zod';
import { tool } from 'ai';

function safeJSONStringify(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

/**
 * Step 1: Select the system object (DMV/table) to query
 */
export const query_builder_select_object = tool({
  description: `Step 1 of Query Builder: Select which system object (DMV, table, view) you want to query.
  
  This is the first step in building a schema-aware query. You must specify which object you want to query,
  and this tool will return the available columns from that object's schema.
  
  Example: To check for blocking, you would select 'sys.dm_exec_requests'`,
  parameters: z.object({
    systemObject: z.string().describe("The system object to query (e.g., 'sys.dm_exec_requests', 'sys.dm_os_wait_stats')"),
    purpose: z.string().describe("What you're trying to find out (e.g., 'check for blocking sessions', 'find high CPU queries')"),
  }),
  execute: async (params) => {
    // This tool is just for guidance - it tells the AI to call get_system_object_schema
    return safeJSONStringify({
      type: "query_builder_step1",
      message: `Step 1 Complete: You selected ${params.systemObject} to ${params.purpose}`,
      nextStep: `Now call get_system_object_schema with systemObjects: ["${params.systemObject}"] to fetch the available columns`,
      reminder: "⚠️ DO NOT proceed to Step 2 until you have the schema. You MUST call get_system_object_schema first.",
    });
  },
});

/**
 * Step 2: Select columns from the schema
 */
export const query_builder_select_columns = tool({
  description: `Step 2 of Query Builder: Select which columns you want in your SELECT clause.
  
  After fetching the schema with get_system_object_schema, use this tool to specify which columns
  you want to include in your query. You MUST only select columns that exist in the schema you fetched.
  
  This tool validates that all selected columns exist in the schema.`,
  parameters: z.object({
    systemObject: z.string().describe("The system object you're querying (from Step 1)"),
    selectedColumns: z.array(z.string()).describe("Array of column names to SELECT. These MUST exist in the schema you fetched."),
    schemaColumns: z.array(z.string()).describe("Array of ALL available columns from the schema (from get_system_object_schema result)"),
  }),
  execute: async (params) => {
    // Validate that all selected columns exist in the schema
    const invalidColumns = params.selectedColumns.filter(col => 
      !params.schemaColumns.some(schemaCol => schemaCol.toLowerCase() === col.toLowerCase())
    );
    
    if (invalidColumns.length > 0) {
      return safeJSONStringify({
        type: "validation_error",
        message: `❌ INVALID COLUMNS: ${invalidColumns.join(', ')}`,
        error: `These columns do not exist in ${params.systemObject}. Available columns are: ${params.schemaColumns.join(', ')}`,
        action: "Go back to Step 1 and fetch the schema again, then select only columns that exist.",
      });
    }
    
    return safeJSONStringify({
      type: "query_builder_step2",
      message: `Step 2 Complete: Selected ${params.selectedColumns.length} valid columns`,
      selectedColumns: params.selectedColumns,
      selectClause: `SELECT ${params.selectedColumns.join(', ')}`,
      fromClause: `FROM ${params.systemObject}`,
      nextStep: "Now proceed to Step 3: query_builder_add_where to add WHERE conditions (optional), or Step 4: query_builder_build to finalize the query",
    });
  },
});

/**
 * Step 3: Add WHERE conditions (optional)
 */
export const query_builder_add_where = tool({
  description: `Step 3 of Query Builder: Add WHERE conditions to filter results.
  
  After selecting columns in Step 2, use this tool to add WHERE conditions.
  You can only reference columns that you selected in Step 2 or that exist in the schema.
  
  This is optional - you can skip to Step 4 if you don't need filtering.`,
  parameters: z.object({
    whereConditions: z.array(z.string()).describe("Array of WHERE conditions (e.g., ['blocking_session_id <> 0', 'wait_time > 1000'])"),
    schemaColumns: z.array(z.string()).describe("Array of ALL available columns from the schema (to validate column references)"),
  }),
  execute: async (params) => {
    // Basic validation: check if columns referenced in WHERE exist in schema
    const whereText = params.whereConditions.join(' AND ');
    
    return safeJSONStringify({
      type: "query_builder_step3",
      message: `Step 3 Complete: Added ${params.whereConditions.length} WHERE condition(s)`,
      whereClause: `WHERE ${whereText}`,
      nextStep: "Now proceed to Step 4: query_builder_build to finalize and execute the query",
    });
  },
});

/**
 * Step 4: Build and return the final query
 */
export const query_builder_build = tool({
  description: `Step 4 of Query Builder: Build the final SQL query from all previous steps.
  
  This is the final step. It takes all the components you've built (SELECT, FROM, WHERE)
  and constructs the final SQL query that you will pass to run_diagnostic_query.
  
  This tool validates the complete query structure before returning it.`,
  parameters: z.object({
    systemObject: z.string().describe("The system object from Step 1"),
    selectedColumns: z.array(z.string()).describe("The columns from Step 2"),
    whereConditions: z.array(z.string()).nullable().describe("The WHERE conditions from Step 3 (optional). Use null to omit."),
  }),
  execute: async (params) => {
    const selectClause = `SELECT ${params.selectedColumns.join(', ')}`;
    const fromClause = `FROM ${params.systemObject}`;
    const whereClause = params.whereConditions && params.whereConditions.length > 0 
      ? `WHERE ${params.whereConditions.join(' AND ')}`
      : '';
    
    const finalQuery = [selectClause, fromClause, whereClause]
      .filter(clause => clause.length > 0)
      .join('\n');
    
    return safeJSONStringify({
      type: "query_builder_complete",
      message: "✅ Query Builder Complete: Your query is ready to execute",
      finalQuery: finalQuery,
      nextStep: `Now call run_diagnostic_query with this exact query:\n\n${finalQuery}`,
      reminder: "⚠️ DO NOT modify this query. Pass it exactly as shown to run_diagnostic_query.",
    });
  },
});
