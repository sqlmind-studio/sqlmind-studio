<template>
  <text-editor
    v-bind="$attrs"
    :value="value"
    @input="$emit('input', $event)"
    :hint="hint"
    :mode="dialectData.textEditorMode"
    :extra-keybindings="keybindings"
    :hint-options="hintOptions"
    :columns-getter="columnsGetter"
    :context-menu-options="handleContextMenuOptions"
    :plugins="plugins"
    :auto-focus="true"
    @update:focus="$emit('update:focus', $event)"
    @update:selection="$emit('update:selection', $event)"
    @update:cursorIndex="$emit('update:cursorIndex', $event)"
    @update:cursorIndexAnchor="$emit('update:cursorIndexAnchor', $event)"
    @update:initialized="$emit('update:initialized', $event)"
  />
</template>

<script lang="ts">
import Vue from "vue";
import TextEditor from "./TextEditor.vue";
import { mapState, mapGetters } from "vuex";
import { plugins } from "@/lib/editor/utils";
import { format } from "sql-formatter";
import { FormatterDialect, dialectFor } from "@shared/lib/dialects/models";
import CodeMirror from "codemirror";
import { AppEvent } from "@/common/AppEvent";

export default Vue.extend({
  components: { TextEditor },
  props: ["value", "connectionType", "extraKeybindings", "contextMenuOptions"],
  computed: {
    ...mapGetters(['defaultSchema', 'dialectData', 'isUltimate']),
    ...mapState(["tables"]),
    hint() {
      // @ts-expect-error not fully typed
      return CodeMirror.hint.sql;
    },
    hintOptions() {
      // We do this so we can order the autocomplete options
      const firstTables = {};
      const secondTables = {};
      const thirdTables = {};

      this.tables.forEach((table) => {
        // don't add table names that can get in conflict with database schema
        if (/\./.test(table.name)) return;

        // Previously we had to provide a table: column[] mapping.
        // we don't need to provide the columns anymore because we fetch them dynamically.
        if (!table.schema) {
          firstTables[table.name] = [];
          return;
        }

        if (table.schema === this.defaultSchema) {
          firstTables[table.name] = [];
          secondTables[`${table.schema}.${table.name}`] = [];
        } else {
          thirdTables[`${table.schema}.${table.name}`] = [];
        }
      });

      const sorted = Object.assign(
        firstTables,
        Object.assign(secondTables, thirdTables)
      );

      return { tables: sorted };
    },
    keybindings() {
      return {
        "Shift-Ctrl-F": this.formatSql,
        "Shift-Cmd-F": this.formatSql,
        ...this.extraKeybindings,
      };
    },
    plugins() {
      const editorPlugins = [
        plugins.autoquote,
        plugins.autoComplete,
        plugins.autoRemoveQueryQuotes(this.queryDialect),
        plugins.queryMagic(() => this.defaultSchema, () => this.tables)
      ];

      return editorPlugins;
    },
    queryDialect() {
      return this.dialectData.queryDialectOverride ?? this.connectionType
    }
  },
  methods: {
    formatSql() {
      const formatted = format(this.value, {
        language: FormatterDialect(dialectFor(this.queryDialect)),
      });
      this.$emit("input", formatted);
    },
    async columnsGetter(tableName: string) {
      let tableToFind = this.tables.find(
        (t) => t.name === tableName || `${t.schema}.${t.name}` === tableName
      );
      if (!tableToFind) return null;
      // Only refresh columns if we don't have them cached.
      if (!tableToFind.columns?.length) {
        await this.$store.dispatch("updateTableColumns", tableToFind);
        tableToFind = this.tables.find(
          (t) => t.name === tableName || `${t.schema}.${t.name}` === tableName
        );
      }

      return tableToFind?.columns.map((c) => c.columnName);
    },
    triggerAIPrompt(prompt: string, aiMode: string = 'code') {
      const isOpen = this.$parent && (this.$parent as any).showInlineAI;
      
      if (!isOpen) {
        this.$root.$emit(AppEvent.toggleInlineAI);
      }
      
      this.$nextTick(() => {
        this.$root.$emit(AppEvent.aiInlinePrompt, { 
          prompt, 
          runAfterInsert: false,
          aiMode 
        });
      });
    },
    handleDocumentQuery() {
      this.triggerAIPrompt('Document this SQL query with detailed comments explaining what each part does');
    },
    handleExplainQuery() {
      this.triggerAIPrompt('Analyze this SQL query by examining the schema and indexes. Explain if this query will perform well or not. If not, provide the best optimized query with recommendations. If it\'s already optimal, just provide recommendations for maintaining good performance.');
    },
    handleFixWithAI() {
      console.log('[SQLTextEditor] handleFixWithAI called');
      // Check if there's a selection in the parent TabQueryEditor
      const parent = this.$parent as any;
      const hasSelection = parent && parent.editor && parent.editor.selection;
      
      // Use appropriate prompt based on selection
      const prompt = hasSelection 
        ? 'Fix errors in the selected query and comment out the broken parts'
        : 'Fix this error and comment out the broken query';
      
      console.log('[SQLTextEditor] Fix with AI prompt:', prompt, 'hasSelection:', hasSelection);
      
      const isOpen = parent && parent.showInlineAI;
      
      if (!isOpen) {
        console.log('[SQLTextEditor] Opening inline AI');
        this.$root.$emit(AppEvent.toggleInlineAI);
      }
      
      this.$nextTick(() => {
        console.log('[SQLTextEditor] Emitting aiInlinePrompt event');
        this.$root.$emit(AppEvent.aiInlinePrompt, { 
          prompt, 
          runAfterInsert: true  // Auto-run after fixing
        });
      });
    },
    handleFineTuneQuery() {
      console.log('[SQLTextEditor] handleFineTuneQuery called');
      // Check if there's a selection in the parent TabQueryEditor
      const parent = this.$parent as any;
      const hasSelection = parent && parent.editor && parent.editor.selection;
      
      // Use @query rewrite command - works with selection or entire query
      const prompt = hasSelection 
        ? 'Rewrite query (selected portion for optimization)'
        : 'Rewrite query';
      
      console.log('[SQLTextEditor] Fine-Tune prompt:', prompt, 'hasSelection:', hasSelection);
      
      const isOpen = parent && parent.showInlineAI;
      
      if (!isOpen) {
        console.log('[SQLTextEditor] Opening inline AI');
        this.$root.$emit(AppEvent.toggleInlineAI);
      }
      
      this.$nextTick(() => {
        console.log('[SQLTextEditor] Emitting aiInlinePrompt event');
        this.$root.$emit(AppEvent.aiInlinePrompt, { 
          prompt, 
          runAfterInsert: false,
          aiMode: 'code'
        });
      });
    },
    handleContextMenuOptions(e: unknown, options: any[]) {
      // Find the divider before "Find" (after "Select All")
      const pivot = options.findIndex((o) => o.name === "Find");
      const newOptions = [
        ...options.slice(0, pivot),
        {
          name: "Format Query",
          slug: "format",
          handler: this.formatSql,
          shortcut: this.ctrlOrCmd("shift+f"),
        },
        {
          type: "divider",
        },
        {
          name: "Document",
          slug: "ai-document",
          handler: this.handleDocumentQuery,
        },
        {
          name: "Explain",
          slug: "ai-explain",
          handler: this.handleExplainQuery,
        },
        {
          name: "Fix with AI",
          slug: "ai-fix",
          handler: this.handleFixWithAI,
        },
        {
          name: "Rewrite with AI",
          slug: "ai-finetune",
          handler: this.handleFineTuneQuery,
        },
        {
          type: "divider",
        },
        ...options.slice(pivot),
      ];

      if (this.contextMenuOptions) {
        return this.contextMenuOptions(e, newOptions);
      }

      return newOptions;
    },
  },
});
</script>
