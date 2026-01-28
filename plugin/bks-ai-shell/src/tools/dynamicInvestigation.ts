/**
 * Dynamic Investigation Workflow
 * 
 * Multi-stage investigation workflow that replicates the inline AI command box stages:
 * 
 * Stage 1: Analyze user question and determine what system objects to check
 * Stage 2: Fetch actual schema for identified objects (columns, parameters, etc.)
 * Stage 3: Generate accurate queries based on real schema
 * Stage 4: Execute queries and collect results
 * Stage 5: Analyze results and identify issues
 * Stage 6: Provide numbered recommendations and next steps
 * Stage 7: Continue investigation based on user selection
 */

import { z } from 'zod';
import { tool } from 'ai';
import { setData, getData } from '@sqlmindstudio/plugin';

// Helper to generate unique request IDs
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Request system object schemas from CoreTabs (same as inline AI command box)
function requestSystemObjectSchemas(systemObjects: string[], requestId: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      console.error('[dynamicInvestigation] Timeout waiting for system object schemas');
      resolve({}); // Return empty object on timeout
    }, 10000); // 10 second timeout
    
    // Listen for schema response
    const handler = (ev: MessageEvent) => {
      const data: any = ev?.data || {};
      if (data.type === 'bks-ai/system-schemas-response' && data.requestId === requestId) {
        clearTimeout(timeoutId);
        window.removeEventListener('message', handler);
        console.log('[dynamicInvestigation] Received system object schemas:', data.schemas);
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
    
    console.log('[dynamicInvestigation] Sending schema request to CoreTabs:', message);
    window.parent.postMessage(message, '*');
  });
}

// Helper to safely stringify JSON
function safeJSONStringify(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Stage 1: Analyze user question and determine what to check
 * 
 * This tool analyzes the user's question and determines which SQL Server system objects
 * need to be checked to answer the question. It returns a list of system objects
 * (DMVs, catalog views, stored procedures, etc.) that should be investigated.
 */
export const analyze_investigation_question = tool({
  description: `Stage 1: Analyze the user's question and determine which SQL Server system objects need to be checked.
  
  This is the first stage of a dynamic investigation workflow. Based on the user's question,
  determine which system DMVs, catalog views, stored procedures, or functions should be queried
  to gather the necessary diagnostic information.
  
  Examples:
  - "Why is SQL Server slow?" → Check sys.dm_exec_requests, sys.dm_os_wait_stats, sys.dm_exec_query_stats
  - "Show me backup history" → Check msdb.dbo.backupset, msdb.dbo.backupmediafamily
  - "Find missing indexes" → Check sys.dm_db_missing_index_details, sys.dm_db_missing_index_groups
  
  Return a JSON object with:
  - reasoning: Brief explanation of what needs to be checked and why
  - systemObjects: Array of system object names to investigate (e.g., ["sys.dm_exec_requests", "sys.dm_os_wait_stats"])
  - investigationType: Type of investigation (e.g., "performance", "backup", "blocking", "index_health")`,
  parameters: z.object({
    userQuestion: z.string().describe("The user's question or request"),
    currentDatabase: z.string().nullable().describe("The currently active database. Use null to omit."),
  }),
  execute: async (params) => {
    // This is a planning tool - it helps the AI determine what to check
    // The actual LLM call will be made by the AI itself in the next step
    return safeJSONStringify({
      type: "stage1_complete",
      message: "Stage 1: Analysis complete. Now call get_system_object_schema to fetch the actual schema for the identified objects.",
      userQuestion: params.userQuestion,
      currentDatabase: params.currentDatabase,
      nextStep: "Call get_system_object_schema with the list of system objects you identified",
    });
  },
});

/**
 * Stage 2: Fetch actual schema for system objects
 * 
 * This tool fetches the real schema (columns, data types, parameters) for the specified
 * system objects. This ensures queries are generated with accurate column names.
 */
export const get_system_object_schema = tool({
  description: `Stage 2: Fetch the actual schema (columns, data types, parameters) for SQL Server system objects.
  
  This tool fetches the real schema for system DMVs, catalog views, stored procedures,
  or functions from CoreTabs. This ensures you generate queries with accurate column names that actually exist.
  
  For DMVs/Views: Returns all column names and data types
  For Stored Procedures: Returns parameter names and data types
  For Functions: Returns parameter names and return columns
  
  Examples:
  - get_system_object_schema(["sys.dm_exec_requests", "sys.dm_os_wait_stats"])
  - get_system_object_schema(["msdb.dbo.backupset"])
  - get_system_object_schema(["sp_whoisactive"])`,
  parameters: z.object({
    systemObjects: z.array(z.string()).describe("Array of system object names to fetch schema for (e.g., ['sys.dm_exec_requests', 'sys.dm_os_wait_stats'])"),
  }),
  execute: async (params) => {
    try {
      const { systemObjects } = params;
      
      if (!systemObjects || systemObjects.length === 0) {
        return safeJSONStringify({
          type: "error",
          message: "No system objects specified. Please provide at least one system object name.",
        });
      }

      const rawList = Array.isArray(systemObjects) ? systemObjects : [];
      const normalizedList = rawList
        .map((s) => String(s || '').trim())
        .filter((s) => !!s);

      const isSystemObjectName = (name: string) => {
        const n = String(name || '').trim();
        const lower = n.toLowerCase();
        return (
          lower.startsWith('sys.') ||
          lower.startsWith('information_schema.') ||
          lower.startsWith('msdb.') ||
          lower.startsWith('master.')
        );
      };

      const looksLikeExpression = (name: string) => {
        const n = String(name || '').trim();
        if (!n) return false;
        if (/^@@[A-Za-z0-9_]+$/.test(n)) return true;
        // SERVERPROPERTY('ProductVersion'), OBJECTPROPERTY(...), etc.
        if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(n)) return true;
        return false;
      };

      const requestedSystemObjects = normalizedList.filter(isSystemObjectName);
      const nonSystemItems = normalizedList.filter((x) => !isSystemObjectName(x));
      const expressionItems = nonSystemItems.filter(looksLikeExpression);
      const otherInvalidItems = nonSystemItems.filter((x) => !looksLikeExpression(x));

      // If the AI mistakenly sends expressions (e.g. @@VERSION, SERVERPROPERTY()),
      // do NOT call CoreTabs schema fetch — it will fail and confuse the user.
      if (requestedSystemObjects.length === 0 && expressionItems.length > 0) {
        return safeJSONStringify({
          type: "info",
          message:
            "This tool fetches schemas for SYSTEM OBJECTS (sys.*, INFORMATION_SCHEMA.*, msdb.*, master.*).\n\n" +
            "The following inputs are expressions/functions (not objects with a schema): " +
            expressionItems.join(', ') +
            "\n\nUse run_diagnostic_query instead. Example:\n" +
            "SELECT @@VERSION AS [Version];\n" +
            "SELECT SERVERPROPERTY('ProductVersion') AS [ProductVersion], SERVERPROPERTY('ProductLevel') AS [ProductLevel], SERVERPROPERTY('Edition') AS [Edition];",
          expressions: expressionItems,
          invalid: otherInvalidItems,
          suggestedDiagnosticQuery:
            "SELECT @@VERSION AS [Version];\n" +
            "SELECT SERVERPROPERTY('ProductVersion') AS [ProductVersion], SERVERPROPERTY('ProductLevel') AS [ProductLevel], SERVERPROPERTY('Edition') AS [Edition];",
        });
      }

      console.log('[get_system_object_schema] Fetching schemas for:', requestedSystemObjects);
      
      // Request schemas from CoreTabs using the same mechanism as inline AI command box
      const requestId = generateRequestId();
      const schemas = await requestSystemObjectSchemas(requestedSystemObjects, requestId);
      
      if (!schemas || Object.keys(schemas).length === 0) {
        let errorMessage = "Failed to fetch schemas from CoreTabs.\n\n";

        if (requestedSystemObjects.length === 0) {
          errorMessage += "🔴 ERROR: This tool is for SYSTEM OBJECTS ONLY (sys.*, INFORMATION_SCHEMA.*, msdb.*, master.*).\n\n";
          errorMessage += "⛔ You tried to fetch schema for: " + normalizedList.join(', ') + "\n\n";
          if (expressionItems.length > 0) {
            errorMessage += "⚠️ These are expressions/functions (not objects with schema): " + expressionItems.join(', ') + "\n";
            errorMessage += "   Use run_diagnostic_query instead.\n\n";
          }
          errorMessage += "✅ For USER objects (stored procedures, tables, views, functions):\n";
          errorMessage += "   1. Use OBJECT_DEFINITION() to get procedure/function/view definitions\n";
          errorMessage += "   2. Use sys.parameters to get procedure parameters\n";
          errorMessage += "   3. Use get_user_table_schema for user table schemas\n\n";
          errorMessage += "💡 You likely already have the data you need from previous queries.\n";
          errorMessage += "   Review the results you already received instead of trying to fetch schema again.\n";
        } else {
          errorMessage += "The system objects may not exist or there was a timeout.\n";
          errorMessage += "Requested objects: " + requestedSystemObjects.join(', ');
          if (expressionItems.length > 0) {
            errorMessage += "\n\n⚠️ Note: expressions/functions were ignored (no schema): " + expressionItems.join(', ');
          }
          if (otherInvalidItems.length > 0) {
            errorMessage += "\n\n⚠️ Note: invalid inputs were ignored: " + otherInvalidItems.join(', ');
          }
        }
        
        return safeJSONStringify({
          type: "error",
          message: errorMessage,
          systemObjects: requestedSystemObjects,
          ignoredExpressions: expressionItems,
          ignoredInvalid: otherInvalidItems,
        });
      }
      
      console.log('[get_system_object_schema] Successfully fetched', Object.keys(schemas).length, 'schemas');
      
      // Format the schemas for the AI to use
      let formattedSchemas = '📋 SYSTEM OBJECT SCHEMAS:\n\n';
      
      for (const [objName, schema] of Object.entries(schemas)) {
        const objType = (schema as any).objectType || 'view';
        formattedSchemas += `${objName} [${objType.toUpperCase().replace(/_/g, ' ')}]:\n`;
        
        // Add columns if available
        if ((schema as any).columns && Array.isArray((schema as any).columns)) {
          formattedSchemas += '  Columns:\n';
          for (const col of (schema as any).columns) {
            formattedSchemas += `    - ${col.name} (${col.type}${col.maxLength > 0 && col.maxLength !== -1 ? `(${col.maxLength})` : ''}${col.nullable ? ', nullable' : ', NOT NULL'})\n`;
          }
        }
        
        // Add parameters if available (for stored procedures)
        if ((schema as any).parameters && Array.isArray((schema as any).parameters)) {
          formattedSchemas += '  Parameters:\n';
          for (const param of (schema as any).parameters) {
            formattedSchemas += `    - ${param.name} (${param.type}${param.maxLength > 0 && param.maxLength !== -1 ? `(${param.maxLength})` : ''}${param.isOutput ? ', OUTPUT' : ''})\n`;
          }
        }
        
        formattedSchemas += '\n';
      }
      
      formattedSchemas += '⚠️ CRITICAL: Use ONLY these exact column names when generating queries.\n';
      formattedSchemas += '⚠️ DO NOT assume columns exist based on naming patterns.\n';
      formattedSchemas += '⚠️ Every column you reference MUST be in the list above.\n';

      if (expressionItems.length > 0) {
        formattedSchemas += '\nℹ️ NOTE: The following were expressions/functions (no schema fetched): ';
        formattedSchemas += expressionItems.join(', ');
        formattedSchemas += '\n';
        formattedSchemas += "ℹ️ Use run_diagnostic_query for these, e.g.: SELECT @@VERSION; or SELECT SERVERPROPERTY('ProductVersion');\n";
      }
      
      return safeJSONStringify({
        type: "stage2_complete",
        message: "Stage 2: Schema fetched successfully from CoreTabs.",
        schemas: schemas,
        formattedSchemas: formattedSchemas,
        systemObjects: requestedSystemObjects,
        ignoredExpressions: expressionItems,
        ignoredInvalid: otherInvalidItems,
        nextStep: "Now generate accurate SQL queries using ONLY the column names listed in the schemas above. Then call run_diagnostic_query to execute the query.",
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});

/**
 * Stage 3: Generate accurate queries based on schema
 * 
 * This tool is called after the schema has been fetched. It helps the AI generate
 * accurate queries using the actual column names from the schema.
 */
export const generate_investigation_query = tool({
  description: `Stage 3: Generate accurate SQL queries based on the fetched schema.
  
  After fetching the schema in Stage 2, use this tool to generate accurate queries
  that use the actual column names that exist in the system objects.
  
  This tool validates that:
  - All column names used in the query exist in the schema
  - Data types are compatible
  - Joins use correct column names
  - WHERE clauses reference valid columns`,
  parameters: z.object({
    investigationType: z.string().describe("Type of investigation (e.g., 'performance', 'backup', 'blocking')"),
    schemaInfo: z.string().describe("The schema information fetched in Stage 2 (JSON string)"),
    userQuestion: z.string().describe("The original user question"),
  }),
  execute: async (params) => {
    return safeJSONStringify({
      type: "stage3_complete",
      message: "Stage 3: Query generation guidance provided. Generate your query using the schema information.",
      investigationType: params.investigationType,
      nextStep: "Generate the SQL query using the actual column names from the schema, then call run_diagnostic_query to execute it",
    });
  },
});

/**
 * Stage 5: Analyze results and identify issues
 * 
 * This tool helps the AI analyze query results and identify issues or patterns.
 */
export const analyze_investigation_results = tool({
  description: `Stage 5: Analyze the query results and identify issues, patterns, or anomalies.
  
  After executing diagnostic queries, use this tool to analyze the results and determine:
  - Are there any issues or problems?
  - What patterns or anomalies exist?
  - What is the root cause?
  - What should be investigated next?`,
  parameters: z.object({
    queryResults: z.string().describe("The results from the diagnostic query (JSON string)"),
    investigationType: z.string().describe("Type of investigation being performed"),
    userQuestion: z.string().describe("The original user question"),
  }),
  execute: async (params) => {
    return safeJSONStringify({
      type: "stage5_complete",
      message: "Stage 5: Analysis guidance provided. Analyze the results and identify issues.",
      nextStep: "Analyze the results, identify issues, and call provide_investigation_recommendations",
    });
  },
});

/**
 * Stage 6: Provide numbered recommendations and next steps
 * 
 * This tool formats the final recommendations with numbered options for the user to choose from.
 * It also STORES the context in memory so the AI can retrieve it when the user replies with a number.
 */
export const provide_investigation_recommendations = tool({
  description: `Stage 6: Provide numbered recommendations and next investigation steps.
  
  After analyzing the results, provide:
  1. Summary of findings
  2. Identified issues or problems
  3. Root cause analysis
  4. Numbered recommendations (what to do next)
  5. Numbered next investigation options (what to check next)
  
  The user can then select a number to continue the investigation.
  
  IMPORTANT: This tool automatically stores the numbered options in memory so you can retrieve them later.`,
  parameters: z.object({
    findings: z.string().describe("Summary of what was found"),
    issues: z.array(z.string()).describe("List of identified issues"),
    rootCause: z.string().nullable().describe("Root cause analysis if determined. Use null to omit."),
    recommendations: z.array(z.object({
      number: z.number(),
      title: z.string(),
      description: z.string(),
      action: z.string(),
    })).describe("Numbered recommendations for fixing issues"),
    nextSteps: z.array(z.object({
      number: z.number(),
      title: z.string(),
      description: z.string(),
      systemObjects: z.array(z.string()),
    })).describe("Numbered options for what to investigate next"),
  }),
  execute: async (params) => {
    const { findings, issues, rootCause, recommendations, nextSteps } = params;
    
    let output = `## Investigation Results\n\n`;
    output += `### Findings\n${findings}\n\n`;
    
    if (issues && issues.length > 0) {
      output += `### Issues Identified\n`;
      issues.forEach((issue, idx) => {
        output += `${idx + 1}. ${issue}\n`;
      });
      output += `\n`;
    }
    
    if (rootCause) {
      output += `### Root Cause\n${rootCause}\n\n`;
    }
    
    if (recommendations && recommendations.length > 0) {
      output += `### Recommendations\n`;
      recommendations.forEach(rec => {
        output += `**${rec.number}. ${rec.title}**\n`;
        output += `${rec.description}\n`;
        output += `Action: ${rec.action}\n\n`;
      });
    }
    
    if (nextSteps && nextSteps.length > 0) {
      output += `### What to Investigate Next\n`;
      nextSteps.forEach(step => {
        output += `**${step.number}. ${step.title}**\n`;
        output += `${step.description}\n\n`;
      });
      output += `\nReply with a number to continue the investigation, or ask a new question.\n`;
    }
    
    // Store the context in memory using a stack approach (list of contexts)
    try {
      const timestamp = Date.now();
      const context = {
        timestamp,
        findings,
        issues,
        rootCause,
        recommendations,
        nextSteps,
      };
      
      // Get existing context stack
      const stackJson = await getData('investigation_context_stack');
      let stack: any[] = [];
      if (stackJson) {
        try {
          stack = JSON.parse(stackJson);
          if (!Array.isArray(stack)) stack = [];
        } catch {
          stack = [];
        }
      }
      
      // Add new context to the stack
      stack.push(context);
      
      // Keep only the last 10 contexts to avoid memory bloat
      if (stack.length > 10) {
        stack = stack.slice(-10);
      }
      
      // Store the updated stack
      await setData('investigation_context_stack', JSON.stringify(stack));
      
      console.log('[provide_investigation_recommendations] Stored investigation context in stack, total contexts:', stack.length);
    } catch (e) {
      console.error('[provide_investigation_recommendations] Failed to store context:', e);
    }
    
    return safeJSONStringify({
      type: "investigation_complete",
      formattedOutput: output,
      recommendations: recommendations,
      nextSteps: nextSteps,
      memoryStored: true,
    });
  },
});

/**
 * Retrieve Investigation Context
 * 
 * This tool retrieves the stored investigation context from memory.
 * Use this when the user replies with a number to find out what that number refers to.
 */
export const retrieve_investigation_context = tool({
  description: `Retrieve the stored investigation context from memory.
  
  Use this tool when the user replies with ONLY a number (e.g., "1", "2", "3") to find out
  what numbered options you previously provided.
  
  This retrieves the stored context including:
  - All numbered recommendations
  - All numbered next investigation steps
  - Previous findings and issues
  
  After retrieving, match the user's number to the corresponding option and continue the investigation.`,
  parameters: z.object({
    userNumber: z.number().describe("The number the user selected (e.g., 1, 2, 3)"),
  }),
  execute: async (params) => {
    try {
      // Get the context stack
      const stackJson = await getData('investigation_context_stack');
      
      if (!stackJson) {
        return safeJSONStringify({
          type: "error",
          message: "No investigation context found in memory. The user may be starting a new investigation.",
        });
      }
      
      // Parse the stack
      let stack: any[] = [];
      try {
        stack = JSON.parse(stackJson);
        if (!Array.isArray(stack) || stack.length === 0) {
          return safeJSONStringify({
            type: "error",
            message: "Investigation context stack is empty. The user may be starting a new investigation.",
          });
        }
      } catch {
        return safeJSONStringify({
          type: "error",
          message: "Failed to parse investigation context stack. This may be a storage error.",
        });
      }
      
      // Get the most recent context from the stack
      const context = stack[stack.length - 1];
      const { userNumber } = params;
      
      // Find the matching option
      let selectedOption = null;
      
      // Check recommendations first
      if (context.recommendations) {
        selectedOption = context.recommendations.find((r: any) => r.number === userNumber);
      }
      
      // Then check next steps
      if (!selectedOption && context.nextSteps) {
        selectedOption = context.nextSteps.find((s: any) => s.number === userNumber);
      }
      
      return safeJSONStringify({
        type: "context_retrieved",
        context: context,
        selectedOption: selectedOption,
        userNumber: userNumber,
        message: selectedOption 
          ? `User selected Option ${userNumber}: ${selectedOption.title}` 
          : `Option ${userNumber} not found in stored context`,
      });
    } catch (e) {
      return safeJSONStringify({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
