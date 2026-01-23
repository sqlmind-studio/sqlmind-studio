<template>
  <div class="chat-input-container">
    <div v-if="attachedFiles.length > 0" class="attached-files">
      <div v-for="(file, index) in attachedFiles" :key="index" class="attached-file">
        <span class="material-symbols-outlined file-icon">description</span>
        <span class="file-name">{{ file.name }}</span>
        <span class="file-size">({{ formatFileSize(file.size) }})</span>
        <button @click="removeFile(index)" class="remove-file-btn" title="Remove file">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="input-field-wrapper">
      <BaseInput ref="input" type="textarea" v-model="input" @keydown.enter="handleEnterKey" @keydown.up="handleUpArrow"
        @keydown.down="handleDownArrow" @keydown.tab="handleTabKey" @keydown.esc="closeSlashMenu" @input="onInputChange($event)" @keyup="onInputChange($event)" @blur="closeSlashMenu" placeholder="Type your message here" rows="1" />
      <div v-if="showCmdMenu && filteredCmds.length" class="slash-menu">
        <div v-for="(cmd, idx) in filteredCmds" :key="cmd.id" class="slash-item" :class="{ active: idx === cmdIndex }" @mousedown.prevent="selectSlash(idx)">
          <span class="slash-title">{{ cmd.label }}</span>
          <span class="slash-alias">{{ cmd.trigger }}{{ cmd.id }}</span>
        </div>
      </div>
    </div>
    <div class="actions">
      <button @click="triggerFileUpload" class="attach-file-btn" title="Attach file" :disabled="processing">
        <span class="material-symbols-outlined">attach_file</span>
      </button>
      <button
        @click.prevent
        class="mic-btn"
        :title="'Coming soon'"
        aria-disabled="true"
        disabled
      >
        <span class="material-symbols-outlined">mic</span>
      </button>
      <input 
        ref="fileInput" 
        type="file" 
        @change="handleFileSelect" 
        style="display: none"
        accept=".txt,.csv,.json,.sql,.xml,.md,.log,.yaml,.yml"
        multiple
      />
      <div class="model-selection" :class="{ 'please-select-a-model': pleaseSelectAModel }" @click="handleModelSelectionClick">
        <Dropdown :model-value="selectedModel" placeholder="Select Model" aria-label="Model" :searchable="true" v-slot="{ searchQuery }">
          <DropdownOption v-for="optionModel in getFilteredModels(searchQuery)" :key="optionModel.id" :value="optionModel.id"
            :selected="matchModel(optionModel, selectedModel)"
            @select="$emit('select-model', optionModel)">
            <span class="model-name">{{ getModelListLabel(optionModel) }}</span>
            <span v-if="optionModel.supportsTools === false" class="no-tools-warning" title="This model doesn't support tools/functions and cannot interact with the database">⚠️</span>
          </DropdownOption>
          <div class="dropdown-separator"></div>
          <button class="dropdown-option dropdown-action" @click="$emit('manage-models')">
            Manage models
          </button>
        </Dropdown>
        <div class="please-select-a-model-hint">
          Please select a model
        </div>
      </div>
      <button v-if="!processing" @click="submit" class="submit-btn" :disabled="!input.trim() && attachedFiles.length === 0" test-id="submit">
        <span class="material-symbols-outlined">send</span>
      </button>
      <button v-else @click="stop" class="stop-btn" />
    </div>
  </div>
</template>

<script lang="ts">
import { PropType, defineComponent } from "vue";
import BaseInput from "./BaseInput.vue";
import Dropdown from "./Dropdown.vue";
import DropdownOption from "./DropdownOption.vue";
import { Model, useChatStore } from "@/stores/chat";
import { mapActions, mapState } from "pinia";
import { matchModel } from "@/utils";
import { useInternalDataStore } from "@/stores/internalData";
import _ from "lodash";

const maxHistorySize = 50;

export default defineComponent({
  components: {
    BaseInput,
    Dropdown,
    DropdownOption,
  },

  watch: {
    // React to any programmatic or user change to the input
    input(newVal: string) {
      this.updateSlashMenu(typeof newVal === 'string' ? newVal : '');
    }
  },

  emits: ["submit", "stop", "manage-models", "select-model"],

  expose: ["focus"],

  props: {
    processing: Boolean,
    storageKey: {
      type: String,
      required: true,
    },
    selectedModel: Object as PropType<Model>,
  },

  data() {
    const inputHistory: string[] = this.loadInputHistory();
    inputHistory.push("");
    return {
      inputHistory,
      inputIndex: inputHistory.length - 1,
      isAtBottom: true,
      pleaseSelectAModel: false,
      attachedFiles: [] as File[],
      isListening: false as boolean,
      speechSupported: false as boolean,
      _recognition: null as any,
      _messageHandler: null as any,
      showCmdMenu: false,
      cmdIndex: 0,
      cmdContext: null as 'command' | 'placeholder' | null,
      filteredCmds: [] as Array<{ id: string; label: string; aliases: string[]; out: string; trigger: '/' | '@' }>,
      lastSubmitText: '' as string,
      lastSubmitAt: 0 as number,
      allCmds: [
        // Slash (analysis) commands
        { trigger: '/', id: 'analyze results', label: 'Auto-detect and analyze active tab results', aliases: ['analyze','auto','detect','results'], out: 'Analyze active tab results' },
        { trigger: '/', id: 'analyze statistics', label: 'Analyze Statistics tab for active query', aliases: ['analyze stats','stats','statistics'], out: 'Analyze statistics for active tab' },
        { trigger: '/', id: 'analyze plan', label: 'Analyze Execution Plan tab for active query', aliases: ['analyze plan','plan','execution plan'], out: 'Analyze execution plan for active tab' },
        { trigger: '/', id: 'analyze blitzcache', label: 'Analyze latest sp_BlitzCache results', aliases: ['analyze bc','bc','blitzcache'], out: 'Analyze latest sp_BlitzCache results' },
        { trigger: '/', id: 'analyze blitzindex', label: 'Analyze latest sp_BlitzIndex results', aliases: ['analyze bi','bi','blitzindex'], out: 'Analyze latest sp_BlitzIndex results' },
        { trigger: '/', id: 'analyze blitzfirst', label: 'Analyze latest sp_BlitzFirst results', aliases: ['analyze bf','bf','blitzfirst'], out: 'Analyze latest sp_BlitzFirst results' },
        { trigger: '/', id: 'analyze blitzlock', label: 'Analyze latest sp_BlitzLock results', aliases: ['analyze bl','bl','blitzlock'], out: 'Analyze latest sp_BlitzLock results' },
        { trigger: '/', id: 'analyze blitzwho', label: 'Analyze latest sp_BlitzWho results', aliases: ['analyze bw','bw','blitzwho'], out: 'Analyze latest sp_BlitzWho results' },
        { trigger: '/', id: 'analyze blitz', label: 'Analyze latest sp_Blitz results', aliases: ['analyze b','b','blitz'], out: 'Analyze latest sp_Blitz results' },
        { trigger: '/', id: 'whoisactive', label: 'Analyze latest sp_WhoIsActive results', aliases: ['who','whois'], out: 'Analyze latest sp_WhoIsActive results' },
        { trigger: '/', id: 'help', label: 'Show available slash commands', aliases: ['?'], out: 'Show AI slash commands help' },

        // At-sign (@) fix commands
        { trigger: '@', id: 'fix results', label: 'Auto-detect and fix issues in active tab', aliases: ['fix','auto fix','detect fix'], out: 'Fix issues in active tab results ' },
        { trigger: '@', id: 'index fix', label: 'Comprehensive index analysis and optimization', aliases: ['index','indexes','index fix'], out: 'Analyze indexes ' },
        { trigger: '@', id: 'query fix', label: 'Query optimization and anti-pattern fixing', aliases: ['query','query fix'], out: 'Optimize query ' },
        { trigger: '@', id: 'query rewrite', label: 'Complete query rewrite for performance', aliases: ['rewrite','rewrite query'], out: 'Rewrite query ' },
        { trigger: '@', id: 'stats fix', label: 'Statistics fixing', aliases: ['statistics','stats','stats fix'], out: 'Fix statistics ' },

        { trigger: '@', id: 'blitzcache row fix', label: 'BlitzCache fixing by row number or hash', aliases: ['bc row','blitzcache row','bc'], out: 'For sp_BlitzCache ' },
        { trigger: '@', id: 'blitzlock row fix', label: 'BlitzLock fixing by row number', aliases: ['blitzlock'], out: 'For sp_BlitzLock ' },
        { trigger: '@', id: 'blitzindex row fix', label: 'BlitzIndex fixing by row number', aliases: ['blitzindex'], out: 'For sp_BlitzIndex ' },
        { trigger: '@', id: 'blitzfirst row fix', label: 'BlitzFirst fixing by row number', aliases: ['blitzfirst'], out: 'For sp_BlitzFirst ' },
        { trigger: '@', id: 'blitz row fix', label: 'Blitz fixing by row number', aliases: ['blitz'], out: 'For sp_Blitz ' },

        { trigger: '@', id: 'plan analysis', label: 'Comprehensive execution plan analysis', aliases: ['plan','plan analysis'], out: 'Analyze execution plan ' },
        { trigger: '@', id: 'deep analysis', label: 'Deep execution plan analysis', aliases: ['deep','deep analysis','deep plan'], out: 'For sp_BlitzCache ' },
        { trigger: '@', id: 'parameter sniffing fix', label: 'Parameter sniffing detection and resolution', aliases: ['sniffing','parameter sniffing'], out: 'Fix parameter sniffing ' },
        { trigger: '@', id: 'tempdb fix', label: 'Tempdb / spills fixing', aliases: ['tempdb','spill fix'], out: 'Fix tempdb issues ' },
        { trigger: '@', id: 'memory grant fix', label: 'Memory grant fixing', aliases: ['memory','grant fix'], out: 'Fix memory grants ' },
        { trigger: '@', id: 'parallelism fix', label: 'Parallelism / MAXDOP fixing', aliases: ['parallel','maxdop'], out: 'Fix parallelism ' },

        { trigger: '@', id: 'index maintenance script', label: 'Index maintenance script', aliases: ['index maintenance','maintenance'], out: 'Generate an index maintenance script for this database: rebuild/reorganize strategy and statistics updates, tuned for large databases. Comment everything clearly and do not execute automatically.' },
        { trigger: '@', id: 'index cleanup', label: 'Index bloat / duplicate cleanup', aliases: ['index cleanup','bloat'], out: 'Using BlitzIndex findings and metadata, propose a script to drop or consolidate unused/duplicate indexes. Include safety checks and comments.' },

        { trigger: '@', id: 'blocking fix', label: 'Blocking sessions fix (sp_WhoIsActive)', aliases: ['blocking','locks','whoisactive blocking'], out: 'For sp_WhoIsActive ' },
        { trigger: '@', id: 'deadlock graph analysis', label: 'Deadlock graph analysis', aliases: ['deadlock'], out: 'Analyze deadlock graph ' },

        { trigger: '@', id: 'waits fix', label: 'Wait stats / server-level fix', aliases: ['waits','wait stats'], out: 'For sp_BlitzFirst ' },
        { trigger: '@', id: 'config fix', label: 'Server configuration fixing', aliases: ['config','configuration'], out: 'Analyze server configuration ' },

        { trigger: '@', id: 'dry run', label: 'Dry run (no changes)', aliases: ['dry run'], out: 'For the fixes you are about to propose, treat this as a dry run: generate scripts and explanations only. Do NOT run or suggest running anything automatically.' },
        { trigger: '@', id: 'rollback script', label: 'Rollback script for last change', aliases: ['rollback'], out: 'Given the last set of index or config changes we discussed, generate a rollback script that restores the previous definition/settings, with comments.' },
        
        // Helper commands for parameters
        { trigger: '/', id: 'rowNumber', label: 'Add rowNumber parameter', aliases: ['row','rownumber'], out: 'rowNumber=' },
        { trigger: '/', id: 'allRows', label: 'Analyze all rows', aliases: ['all','allrows','all rows'], out: 'allRows' },
        { trigger: '/', id: 'QUERY_HASH_HEX', label: 'Add QUERY_HASH_HEX parameter', aliases: ['hash','query hash','hex'], out: 'QUERY_HASH_HEX=' },
        { trigger: '/', id: 'resultTab', label: 'Add resultTab parameter', aliases: ['result','tab','resulttab'], out: 'resultTab=' },
        { trigger: '/', id: 'statsTab', label: 'Specify Statistics tab number', aliases: ['stats tab','statistics tab','statstab'], out: 'statsTab=' },
        { trigger: '/', id: 'planTab', label: 'Specify Execution Plan tab number', aliases: ['plan tab','execution plan tab','plantab'], out: 'planTab=' },
        { trigger: '/', id: 'queryTab', label: 'Specify query tab number', aliases: ['querytab','tabnumber','tab num'], out: 'queryTab=' },
        { trigger: '/', id: 'deepDive', label: 'Deep dive analysis with additional context', aliases: ['deep','deepdive','deep dive','comprehensive'], out: 'deepDive' },
        { trigger: '/', id: 'database', label: 'Specify database name', aliases: ['db','database'], out: 'database=' },
        { trigger: '/', id: 'schema', label: 'Specify schema name', aliases: ['schema','sch'], out: 'schema=' },
        { trigger: '/', id: 'table', label: 'Specify table name', aliases: ['table','tbl'], out: 'table=' },
        { trigger: '/', id: 'column', label: 'Specify column name', aliases: ['column','col'], out: 'column=' },
        { trigger: '/', id: 'lineNumber', label: 'Specify query line number', aliases: ['line','linenumber','ln'], out: 'lineNumber=' },
        { trigger: '/', id: 'fromLineNumber', label: 'Specify starting line number', aliases: ['from','fromline','from line'], out: 'fromLineNumber=' },
        { trigger: '/', id: 'toLineNumber', label: 'Specify ending line number', aliases: ['to','toline','to line'], out: 'toLineNumber=' },
      ],
    };
  },

  computed: {
    ...mapState(useChatStore, {
      filteredModels(store) {
        return store.models.filter((m) => m.enabled);
      },
    }),
    input: {
      get() {
        return this.inputHistory[this.inputIndex];
      },
      set(value: string) {
        this.inputHistory[this.inputIndex] = value;
      },
    },
  },

  mounted() {
    // Initialize speech recognition support so the mic button can enable if available
    this.initSpeech();
    
    // Listen for messages from parent window to set input and submit
    this._messageHandler = (event: MessageEvent) => {
      const data = event.data;

      // Many host RPC replies come back as a bare object like { id, result } with no `type`.
      // These are internal responses and can include `result: undefined`. Don't spam the console.
      try {
        const isBareRpcReply =
          data && typeof data === 'object' && !('type' in data) && ('id' in data) && ('result' in data);
        if (!isBareRpcReply) {
          console.log('[PromptInput] Raw message event:', {
            origin: event.origin,
            source: event.source,
            dataType: typeof event.data,
            data: event.data
          });
        }
      } catch (_) {
        // If the guard fails, fall back to logging
        console.log('[PromptInput] Raw message event:', {
          origin: event.origin,
          source: event.source,
          dataType: typeof event.data,
          data: event.data
        });
      }
      
      if (data && data.type === 'set-and-submit-input' && data.text) {
        console.log('[PromptInput] Received set-and-submit-input:', data.text, 'hasContext:', !!data.context);
        
        // Store context data if provided (execution plan XML, statistics)
        if (data.context) {
          console.log('[PromptInput] Storing context data:', {
            hasExecutionPlan: !!data.context.executionPlanXml,
            executionPlanLength: data.context.executionPlanXml?.length || 0,
            hasStatistics: !!data.context.statistics
          });
          
          // Store in session storage for the AI to access
          try {
            sessionStorage.setItem('bks-ai-rewrite-context', JSON.stringify(data.context));
          } catch (e) {
            console.error('[PromptInput] Failed to store context:', e);
          }
        }
        
        // Set the input text
        this.input = data.text;
        // Submit after a short delay to ensure the input is set
        this.$nextTick(() => {
          setTimeout(() => {
            this.submit();
          }, 100);
        });
      }
      // Handle insert-command message (just insert, don't submit)
      if (data && data.type === 'bks-ai/insert-command' && data.command) {
        console.log('[PromptInput] Matched insert-command, setting input to:', data.command);
        // Set the input text without submitting
        this.input = data.command;
        // Focus the input field
        this.$nextTick(() => {
          this.focus();
        });
      }
    };
    console.log('[PromptInput] Mounted, window:', window.location.href);
    console.log('[PromptInput] Adding message listener to window');
    window.addEventListener('message', this._messageHandler);
  },
  
  beforeDestroy() {
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
    }
  },

  methods: {
    ...mapActions(useInternalDataStore, ["setInternal"]),
    matchModel,

    focus() {
      const input = this.$refs.input as InstanceType<typeof BaseInput> | undefined;
      if (input && typeof (input as any).focus === 'function') {
        (input as any).focus();
      }
    },

    initSpeech() {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.speechSupported = !!SR;
      if (!SR) return;

      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      try {
        // Use browser default language
        recognition.lang = navigator.language || 'en-US';
      } catch (_) {}

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else interim += res[0].transcript;
        }
        const current = this.inputHistory[this.inputIndex] || '';
        if (finalText) {
          this.inputHistory[this.inputIndex] = (current + ' ' + finalText).trim();
        } else if (interim) {
          this.inputHistory[this.inputIndex] = (current.replace(/\s+$/, '') + ' ' + interim).trim();
        }
      };

      recognition.onerror = () => {
        this.isListening = false;
      };

      recognition.onend = () => {
        this.isListening = false;
      };

      this._recognition = recognition;
    },

    async toggleMic() {
      if (!this._recognition) this.initSpeech();
      if (!this.speechSupported || !this._recognition) return;
      if (this.isListening) {
        try { this._recognition.stop(); } catch (_) {}
        this.isListening = false;
      } else {
        try { this._recognition.start(); this.isListening = true; } catch (_) { this.isListening = false; }
      }
    },

    onMicClick() {
      if (!this._recognition) this.initSpeech();
      if (!this.speechSupported || !this._recognition) {
        alert('Voice input is not supported in this environment. If you are running in Electron, the Web Speech API may be unavailable.');
        return;
      }
      this.toggleMic();
    },

    getFilteredModels(searchQuery: string) {
      if (!searchQuery || !searchQuery.trim()) {
        return this.filteredModels;
      }
      const query = searchQuery.toLowerCase();
      return this.filteredModels.filter((model) => {
        const label = this.getModelListLabel(model).toLowerCase();
        return (
          model.id.toLowerCase().includes(query) ||
          model.displayName.toLowerCase().includes(query) ||
          label.includes(query) ||
          model.providerDisplayName.toLowerCase().includes(query)
        );
      });
    },

    getModelListLabel(model: any) {
      const displayName = String(model?.displayName || model?.id || '').trim();
      const raw = model?.creditMultiplier;
      const n = typeof raw === 'number' ? raw : raw != null ? parseInt(String(raw), 10) : 1;
      const mul = Number.isFinite(n) && n > 0 ? n : 1;
      return `${displayName} [${mul}x]`;
    },

    async submit() {
      const trimmedInput = this.input.trim();

      // Guard against accidental double-submit (same text emitted twice in quick succession)
      // This can happen when both key handlers and menu handlers fire.
      try {
        const now = Date.now();
        if (trimmedInput && this.lastSubmitText === trimmedInput && (now - this.lastSubmitAt) < 800) {
          return;
        }
        this.lastSubmitText = trimmedInput;
        this.lastSubmitAt = now;
      } catch (_) {}

      // Don't send empty messages unless there are files
      if (!trimmedInput && this.attachedFiles.length === 0) return;

      if (!this.selectedModel) {
        this.pleaseSelectAModel = true;
        return;
      }

      // Read file contents
      let fileContents = '';
      if (this.attachedFiles.length > 0) {
        const filePromises = this.attachedFiles.map(file => this.readFileContent(file));
        const contents = await Promise.all(filePromises);
        fileContents = contents.map((content, index) => {
          return `\n\n--- File: ${this.attachedFiles[index].name} ---\n${content}\n--- End of ${this.attachedFiles[index].name} ---`;
        }).join('\n');
      }

      const messageWithFiles = trimmedInput + fileContents;

      this.addToHistory(this.input);
      this.resetInput();
      this.attachedFiles = []; // Clear attached files after sending

      this.$emit("submit", messageWithFiles);
    },

    triggerFileUpload() {
      (this.$refs.fileInput as HTMLInputElement).click();
    },

    handleFileSelect(event: Event) {
      const target = event.target as HTMLInputElement;
      const files = target.files;
      if (files) {
        // Add files to attachedFiles array
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          // Check file size (limit to 1MB per file)
          if (file.size > 1024 * 1024) {
            alert(`File ${file.name} is too large. Maximum size is 1MB.`);
            continue;
          }
          this.attachedFiles.push(file);
        }
      }
      // Reset input so the same file can be selected again
      target.value = '';
    },

    removeFile(index: number) {
      this.attachedFiles.splice(index, 1);
    },

    async readFileContent(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve(e.target?.result as string);
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    },

    formatFileSize(bytes: number): string {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    stop() {
      this.$emit("stop");
    },

    handleModelSelectionClick() {
      this.pleaseSelectAModel = false;
    },

    handleEnterKey(e: KeyboardEvent) {
      if (e.shiftKey) {
        // Allow default behavior (new line) when Shift+Enter is pressed
        return;
      }

      if (!this.processing) {
        if (this.showCmdMenu && this.filteredCmds.length) {
          e.preventDefault();
          e.stopPropagation();
          this.executeSlash(true);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      }
    },

    handleTabKey(e: KeyboardEvent) {
      if (this.showCmdMenu && this.filteredCmds.length) {
        e.preventDefault();
        e.stopPropagation();
        this.executeSlash(false);
      }
    },

    // Handle up/down arrow keys for history navigation
    handleUpArrow(e: KeyboardEvent) {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = text.substring(0, cursorPos);

      if (this.showCmdMenu && this.filteredCmds.length) {
        e.preventDefault();
        e.stopPropagation();
        this.cmdIndex = (this.cmdIndex - 1 + this.filteredCmds.length) % this.filteredCmds.length;
        this.scrollMenuToActiveItem();
        return;
      }
      if (cursorPos === 0 || textBeforeCursor.lastIndexOf("\n") === -1) {
        e.preventDefault();
        e.stopPropagation();

        this.navigateHistory(-1);
      }
    },

    handleDownArrow(e: KeyboardEvent) {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;

      const cursorPos = textarea.selectionStart;
      const textAfterCursor = text.substring(cursorPos);

      if (this.showCmdMenu && this.filteredCmds.length) {
        e.preventDefault();
        e.stopPropagation();
        this.cmdIndex = (this.cmdIndex + 1) % this.filteredCmds.length;
        this.scrollMenuToActiveItem();
        return;
      }
      if (cursorPos === text.length || textAfterCursor.indexOf("\n") === -1) {
        e.preventDefault();
        e.stopPropagation();

        this.navigateHistory(1);
      }
    },

    /** Navigate through input history. Returns true if input changed. */
    navigateHistory(direction: 1 | -1) {
      const oldIndex = this.inputIndex;

      this.inputIndex = _.clamp(
        this.inputIndex + direction,
        0,
        this.inputHistory.length - 1,
      );

      const changed = this.inputIndex !== oldIndex;

      if (changed) {
        // Place cursor at the end of the input text
        this.$nextTick(() => {
          const textarea = document.querySelector("textarea");
          if (textarea) {
            textarea.selectionStart = textarea.selectionEnd =
              textarea.value.length;
          }
        });
      }

      return changed;
    },

    addToHistory(input: string) {
      const oldHistory = this.loadInputHistory();

      let newHistory = [...oldHistory];

      if (oldHistory[oldHistory.length - 1] === input || input.startsWith(" ")) {
        this.resetHistory(newHistory);
        return;
      }

      newHistory.push(input);

      // Limit history size
      if (newHistory.length > maxHistorySize) {
        newHistory = newHistory.slice(-maxHistorySize);
      }

      localStorage.setItem(this.storageKey, JSON.stringify(newHistory));

      this.resetHistory(newHistory);
    },

    resetHistory(history: string[]) {
      this.inputHistory = history;
      this.inputIndex = this.inputHistory.length - 1;
    },

    resetInput() {
      if (this.inputHistory[this.inputHistory.length - 1] === "") {
        this.inputIndex = this.inputHistory.length - 1;
      } else {
        this.inputHistory.push("");
        this.inputIndex = this.inputHistory.length - 1;
      }
    },

    loadInputHistory(): string[] {
      const inputHistoryStr = localStorage.getItem(this.storageKey) || "[]";
      return JSON.parse(inputHistoryStr);
    },

    onInputChange(e: Event) {
      // Ignore arrow key re-triggers so we don't reset selection while navigating
      if ((e as KeyboardEvent)?.key === 'ArrowDown' || (e as KeyboardEvent)?.key === 'ArrowUp') {
        return;
      }
      // Use the raw textarea value from the event to avoid v-model update timing
      const raw = (e && (e.target as HTMLTextAreaElement)?.value) || this.input || '';
      this.updateSlashMenu(raw);
    },

    closeSlashMenu() {
      this.showCmdMenu = false;
      this.filteredCmds = [];
      this.cmdIndex = 0;
      this.cmdContext = null;
    },

    updateSlashMenu(rawVal?: string) {
      const raw = (typeof rawVal === 'string' ? rawVal : this.input) || '';
      const trimmedStart = raw.trimStart();
      const first = trimmedStart.charAt(0);
      const endsWithSlash = raw.endsWith('/');

      // Top-level command menu: leading '/' or '@'
      if (first === '/' || first === '@') {
        this.cmdContext = 'command';
        const val = trimmedStart;
        const q = val.slice(1).toLowerCase();
        const helperIds = ['rowNumber', 'allRows', 'QUERY_HASH_HEX', 'resultTab', 'statsTab', 'planTab', 'queryTab', 'deepDive', 'database', 'schema', 'table', 'column', 'lineNumber', 'fromLineNumber', 'toLineNumber'];
        const matches = (c: any) => {
          if (c.trigger !== first) return false;
          // For a bare '/' show only main commands; once the user types beyond '/', allow helpers too
          if (first === '/' && helperIds.includes(c.id) && q.length === 0) return false;
          return [c.id, c.label, ...(c.aliases || [])].some((s: string) => s.toLowerCase().includes(q));
        };
        const prev = this.filteredCmds;
        const prevSelectedId = (prev && prev[this.cmdIndex] && prev[this.cmdIndex].id) || null;
        // Show all commands when just typing '@' or '/', otherwise limit to 8 matches
        const maxResults = q.length === 0 ? 100 : 8;
        const next = this.allCmds.filter(matches).slice(0, maxResults);
        this.filteredCmds = next;
        this.showCmdMenu = this.filteredCmds.length > 0;
        // Preserve current selection by command id if it still exists in the new list
        if (prevSelectedId) {
          const keepIdx = this.filteredCmds.findIndex(c => c.id === prevSelectedId);
          if (keepIdx >= 0) {
            this.cmdIndex = keepIdx;
            return;
          }
        }
        // Otherwise clamp to start
        this.cmdIndex = this.filteredCmds.length ? 0 : 0;
        return;
      }

      // Parameter placeholder menu: user typed '/' somewhere in the text (but NOT at the start)
      // Only show helper commands if there's content before the trailing slash
      if (endsWithSlash && first !== '/') {
        this.cmdContext = 'placeholder';
        // Filter helper commands from allCmds
        const helperCmds = this.allCmds.filter(c => c.trigger === '/' && (c.id === 'rowNumber' || c.id === 'allRows' || c.id === 'QUERY_HASH_HEX' || c.id === 'resultTab' || c.id === 'queryTab' || c.id === 'deepDive' || c.id === 'database' || c.id === 'schema' || c.id === 'table' || c.id === 'column' || c.id === 'lineNumber' || c.id === 'fromLineNumber' || c.id === 'toLineNumber'));
        this.filteredCmds = helperCmds.slice(0, 10);
        this.showCmdMenu = this.filteredCmds.length > 0;
        this.cmdIndex = this.filteredCmds.length ? 0 : 0;
        return;
      }

      // Otherwise, hide the menu
      this.showCmdMenu = false;
      this.filteredCmds = [];
      this.cmdIndex = 0;
      this.cmdContext = null;
    },

    selectSlash(idx: number) {
      this.cmdIndex = idx;
      this.executeSlash();
    },

    executeSlash(shouldSubmit: boolean = true) {
      if (!this.filteredCmds.length) return;
      const cmd = this.filteredCmds[this.cmdIndex] || this.filteredCmds[0];
      const out = cmd.out || '';
      if (!out) return;
      const context = this.cmdContext;
      // Placeholder context: insert at the position of the triggering '/'
      if (context === 'placeholder') {
        const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
        const current = this.input || '';
        if (textarea) {
          const cursorPos = textarea.selectionStart;
          const slashPos = current.lastIndexOf('/', cursorPos - 1);
          const insertPos = slashPos >= 0 ? slashPos : cursorPos;
          const before = current.slice(0, insertPos);
          const after = current.slice(cursorPos);
          const nextVal = before + out + after;
          this.input = nextVal;
          this.$nextTick(() => {
            const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
            if (ta) {
              const newCursor = before.length + out.length;
              ta.selectionStart = ta.selectionEnd = newCursor;
            }
          });
        } else {
          this.input = current + out;
        }
      } else {
        // Command context: replace input with the command text
        this.input = out;
      }
      this.showCmdMenu = false;
      this.filteredCmds = [];
      this.cmdIndex = 0;
      this.cmdContext = null;

      // For top-level '/' analysis commands, auto-submit as before.
      // For '@' fix commands and placeholder parameters, let the user edit and press Enter manually.
      if (shouldSubmit && cmd.trigger === '/' && context !== 'placeholder') {
        this.submit();
      }
    },

    scrollMenuToActiveItem() {
      // Use nextTick to ensure DOM is updated after cmdIndex changes
      this.$nextTick(() => {
        const menu = document.querySelector('.slash-menu');
        const activeItem = document.querySelector('.slash-item.active');
        if (menu && activeItem) {
          const menuRect = menu.getBoundingClientRect();
          const itemRect = activeItem.getBoundingClientRect();
          
          // Check if item is below visible area
          if (itemRect.bottom > menuRect.bottom) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          // Check if item is above visible area
          else if (itemRect.top < menuRect.top) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
    },
  },
});
</script>

<style scoped>
.input-field-wrapper {
  position: relative;
}
.slash-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  background: var(--theme-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.18);
  max-height: 220px;
  overflow-y: auto;
  z-index: 20;
}
.slash-item {
  padding: 6px 10px;
  display: flex;
  justify-content: space-between;
  cursor: pointer;
}
.slash-item.active {
  background: var(--selection);
}
.slash-title { font-size: 12px; }
.slash-alias { opacity: 0.6; font-size: 11px; }
</style>
