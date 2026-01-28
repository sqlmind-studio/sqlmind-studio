<template>
  <div v-if="!shouldHideTool" class="tool" :data-tool-name="toolCall.toolName" :data-tool-state="toolCall.state"
    :data-tool-empty-result="isEmptyResult" :data-tool-error="!!error" :data-tool-has-query="!!resolvedQuery"
    :data-tool-has-data="!!data" :data-tool-args-type="argsType" :data-tool-result-type="resultType">
    <div class="tool-name">{{ displayName }}</div>
    <!-- Hide query display in Code Mode for run_current_query -->
    <markdown v-if="!shouldHideResults && (toolCall.toolName === 'run_query' || toolCall.toolName === 'run_current_query') && resolvedQuery" :content="'```sql\n' + displayQuery + '\n```'" />
    <markdown v-if="shouldShowDiagnosticDetails && resolvedQuery" :content="'```sql\n' + displayQuery + '\n```'" />
    <!-- Hide results separator in Code Mode for run_current_query -->
    <div v-if="!shouldHideResults && (toolCall.toolName === 'run_query' || toolCall.toolName === 'run_current_query') && data && !error" class="query-results-separator">
      <span class="separator-text">Results</span>
    </div>
    <div v-if="shouldShowDiagnosticDetails && data && !error" class="query-results-separator">
      <span class="separator-text">Results</span>
    </div>
    <div v-if="askingPermission" class="tool-permission-prompt">
      {{
        toolCall.toolName === "run_query" || toolCall.toolName === "run_current_query"
          ? "Do you want to run this query?"
          : "Do you want to proceed?"
      }}
      <div class="tool-permission-buttons">
        <button class="accept-btn" @click="$emit('accept')">
          Yes
          <span class="material-symbols-outlined accept-icon"> check </span>
        </button>
        <button class="reject-btn" @click="$emit('reject')">
          No
          <span class="material-symbols-outlined reject-icon"> close </span>
        </button>
      </div>
    </div>
    <div class="tool-error error" v-if="error" v-text="error" />
    <div v-else-if="toolCall.state !== 'result' && !askingPermission" class="tool-pending">
      <span class="spinner small"></span>
      <span class="thinking-text">Thinking…</span>
    </div>
    <markdown v-else-if="shouldShowDiagnosticDetails && toolCall.toolName === 'run_diagnostic_query' && (!data || isEmptyResult) && rawResult" :content="rawResultContent" />
    <!-- Hide results in Code Mode for run_current_query -->
    <div class="tool-result" v-else-if="data && !shouldHideResults">
      <template v-if="toolCall.toolName === 'get_connection_info'">
        {{ data.connectionType }}
      </template>
      <template v-if="toolCall.toolName === 'get_tables'">
        {{ data.length }}
        {{ $pluralize("table", data.length) }}
      </template>
      <template v-if="toolCall.toolName === 'get_columns'">
        {{ data.length }}
        {{ $pluralize("column", data.length) }}
      </template>
      <run-query-result v-else-if="(toolCall.toolName === 'run_query' || toolCall.toolName === 'run_current_query') && data" :data="data" />
      <run-query-result v-else-if="shouldShowDiagnosticDetails && data" :data="diagnosticResultData" />
    </div>
  </div>
</template>

<script lang="ts">
import Markdown from "@/components/messages/Markdown.vue";
import { ToolInvocation } from "ai";
import { PropType } from "vue";
import { safeJSONStringify } from "@/utils";
import RunQueryResult from "@/components/messages/tool/RunQueryResult.vue";
import { isErrorContent, parseErrorContent } from "@/utils";
import { formatSqlForDisplay } from "@/markdownParser";
import _ from "lodash";
import { mapState } from "pinia";
import { useInternalDataStore } from "@/stores/internalData";
import { useConfigurationStore } from "@/stores/configuration";

export default {
  components: { Markdown, RunQueryResult },
  props: {
    askingPermission: Boolean,
    toolCall: {
      type: Object as PropType<ToolInvocation>,
      required: true,
    },
  },
  emits: ["accept", "reject"],
  computed: {
    ...mapState(useInternalDataStore, ["outputMode"]),
    ...mapState(useConfigurationStore, ["alwaysShowDiagnosticQueriesInChat"]),
    argsType() {
      try {
        const raw: any = (this.toolCall as any)?.args ?? (this.toolCall as any)?.arguments;
        return raw === null ? 'null' : typeof raw;
      } catch (_) {
        return 'unknown';
      }
    },
    resultType() {
      try {
        const raw: any = (this.toolCall as any)?.result;
        return raw === null ? 'null' : typeof raw;
      } catch (_) {
        return 'unknown';
      }
    },
    toolArgs() {
      // ToolInvocation.args can be either an object or a JSON string depending on the AI SDK/provider.
      try {
        const raw: any = (this.toolCall as any)?.args ?? (this.toolCall as any)?.arguments;
        if (!raw) return {};
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        }
        if (typeof raw === 'object') return raw;
        return {};
      } catch (_) {
        return {};
      }
    },
    resolvedQuery() {
      // Different AI SDK/provider versions use different shapes for tool invocation arguments.
      // Prefer args.query, but also support nested { params: { query } } and legacy { arguments: { query } }.
      try {
        const a: any = this.toolArgs as any;
        let legacyArgs: any = (this.toolCall as any)?.arguments;
        try {
          if (typeof legacyArgs === 'string') legacyArgs = JSON.parse(legacyArgs);
        } catch (_) {}
        const data: any = this.data as any;

        const q =
          a?.query ||
          a?.args?.query ||
          a?.params?.query ||
          legacyArgs?.query ||
          legacyArgs?.args?.query ||
          legacyArgs?.params?.query ||
          data?.query ||
          data?.args?.query ||
          data?.params?.query ||
          data?.request?.query;

        const s = String(q || '').trim();
        return s ? s : '';
      } catch (_) {
        return '';
      }
    },
    isCodeMode() {
      return this.outputMode === 'code';
    },
    shouldShowDiagnosticDetails() {
      return (
        !!this.alwaysShowDiagnosticQueriesInChat &&
        this.toolCall.toolName === 'run_diagnostic_query'
      );
    },
    diagnosticResultData() {
      // run_diagnostic_query returns { type, explanation, results: <runQuery result>, ... }
      // RunQueryResult expects the same shape as run_query: { results: [...] }
      try {
        const d: any = this.data as any;
        return d?.results || d;
      } catch (_) {
        return this.data;
      }
    },
    displayQuery() {
      try {
        const raw = String(this.resolvedQuery || '').trim();
        return raw ? formatSqlForDisplay(raw) : '';
      } catch (_) {
        return '';
      }
    },
    shouldHideTool() {
      // Hide user rejection errors - they're internal feedback to AI, not for display
      if (this.error && /user rejected/i.test(this.error)) {
        return true;
      }
      // In Code Mode, hide tool entries until they have a result, EXCEPT for get_tab_list and open_new_tab
      // which are part of the visible flow
      if (this.isCodeMode && this.toolCall.state !== 'result') {
        // Never hide when we're explicitly asking for permission (show Yes/No)
        if (this.askingPermission) return false;
        const toolName = this.toolCall.toolName;
        // Always hide get_query_text in Code Mode to avoid noise
        if (toolName === 'get_query_text') return true;
        // Always show get_tab_list and open_new_tab in the flow
        if (toolName === 'get_tab_list' || toolName === 'open_new_tab') {
          return false;
        }
        return true;
      }
      // In Code Mode, also hide get_query_text results entirely
      if (this.isCodeMode && this.toolCall.toolName === 'get_query_text') return true;
      // Additionally hide coalesced/deferred confirmations
      try {
        const d = this.data;
        if (d && (d.coalesced === true || /deferred/i.test(d.message || ''))) return true;
      } catch {}
      return false;
    },
    shouldHideResults() {
      // ALWAYS hide results for run_current_query because they appear in the query tab UI
      // This prevents results from appearing when switching from Code mode to Chat mode
      // run_current_query is designed to execute queries in the tab, not display results in chat
      return this.toolCall.toolName === 'run_current_query';
    },
    isEmptyResult() {
      if (this.toolCall.state === "result") {
        return _.isEmpty(
          this.toolCall.toolName === "run_query"
            ? this.data.results?.[0]?.rows
            : this.data,
        );
      }
      return true;
    },
    content() {
      if (this.data) {
        let str = "";

        try {
          str = safeJSONStringify(this.data, null, 2);
        } catch (e) {
          // do nothing
        }

        return "```json\n" + str + "\n```";
      }

      return "";
    },
    rawResult() {
      if (this.toolCall.state !== 'result') {
        return null;
      }
      try {
        let raw: any =
          (this.toolCall as any)?.result ??
          (this.toolCall as any)?.output ??
          (this.toolCall as any)?.response;
        // Some SDKs wrap tool results: { result: <payload> } or { toolResult: { result: <payload> } }
        if (raw && typeof raw === 'object') {
          if ((raw as any).toolResult && typeof (raw as any).toolResult === 'object') {
            raw = (raw as any).toolResult;
          }
          if ((raw as any).result != null && Object.keys(raw as any).length <= 4) {
            raw = (raw as any).result;
          }
        }
        if (raw == null) return null;
        if (typeof raw === 'string') {
          const s = raw.trim();
          return s ? s : null;
        }
        if (typeof raw === 'object') {
          return safeJSONStringify(raw, null, 2);
        }
        return null;
      } catch (_) {
        return null;
      }
    },
    rawResultContent() {
      if (!this.rawResult) return '';
      return '```json\n' + String(this.rawResult) + '\n```';
    },
    data() {
      if (this.toolCall.state !== 'result') {
        return null;
      }
      try {
        let raw: any =
          (this.toolCall as any)?.result ??
          (this.toolCall as any)?.output ??
          (this.toolCall as any)?.response;
        // Some SDKs wrap tool results: { result: <payload> } or { toolResult: { result: <payload> } }
        if (raw && typeof raw === 'object') {
          if ((raw as any).toolResult && typeof (raw as any).toolResult === 'object') {
            raw = (raw as any).toolResult;
          }
          if ((raw as any).result != null && Object.keys(raw as any).length <= 4) {
            raw = (raw as any).result;
          }
        }
        if (raw == null) return null;
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          const unfenced = trimmed
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          return JSON.parse(unfenced);
        }
        if (typeof raw === 'object') {
          return raw;
        }
        return null;
      } catch (e) {
        return null;
      }
    },
    error() {
      if (this.toolCall.state !== 'result') {
        return null;
      }
      if (isErrorContent(this.toolCall.result)) {
        const err = parseErrorContent(this.toolCall.result);
        return err.message ?? err;
      }
    },
    displayName() {
      if (this.toolCall.toolName === "get_columns") {
        if ((this.toolArgs as any).schema) {
          return `Get Columns (schema: ${(this.toolArgs as any).schema}, table: ${(this.toolArgs as any).table})`;
        }
        return `Get Columns (${(this.toolArgs as any).table})`;
      }
      return this.toolCall.toolName.split("_").map(_.capitalize).join(" ");
    },
  },
  methods: {
    truncateAtWord(str, maxLength) {
      if (str.length <= maxLength) return str;
      return str.slice(0, str.lastIndexOf(" ", maxLength)) + "…";
    },
  },
};
</script>
