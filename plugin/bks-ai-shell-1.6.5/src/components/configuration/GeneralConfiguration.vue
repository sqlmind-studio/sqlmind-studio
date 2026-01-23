<template>
  <h2>General</h2>
  <BaseInput :model-value="customInstructions" @change="handleChange" type="textarea"
    placeholder="Example: Before executing a query, review it for potential issues." rows="4">
    <template #label>Custom Instructions</template>
    <template #helper>Custom instructions are added to the default instructions and included as a system prompt with every message you send. These instructions apply globally across all connections.</template>
  </BaseInput>
  <BaseInput type="switch" :model-value="allowExecutionOfReadOnlyQueries" @click="handleSwitchClick">
    <template #label>
      Always allow read-only queries to execute without confirmation.
    </template>
    <template #helper>
      Read-only queries can be executed without confirmation across all sessions..
    </template>
  </BaseInput>
  <BaseInput type="switch" :model-value="alwaysShowDiagnosticQueriesInChat" @click="handleShowDiagnosticQueriesClick">
    <template #label>
      Always show diagnostic queries in chat
    </template>
    <template #helper>
      When enabled, diagnostic tool calls (SQL + Results) will always be visible in chat.
    </template>
  </BaseInput>
  <BaseInput type="switch" :model-value="allowBroadSystemDiagnosticProcedures" @click="handleAllowBroadSystemDiagnosticProceduresClick">
    <template #label>
      Allow broad system diagnostic procedures
    </template>
    <template #helper>
      When enabled, the diagnostic tool can execute a wider range of system stored procedures (sp_*) in master/msdb/model/tempdb.
    </template>
  </BaseInput>
  <BaseInput type="switch" :model-value="deepInvestigationMode" @click="handleDeepInvestigationModeClick">
    <template #label>
      Deep Investigation Mode
    </template>
    <template #helper>
      When enabled, the AI will run a deeper diagnostic investigation (more queries) before concluding.
      When disabled, it will prioritize a smaller set of critical queries for faster results.
    </template>
  </BaseInput>
</template>

<script lang="ts">
import { mapActions, mapState } from "pinia";
import BaseInput from "@/components/common/BaseInput.vue";
import { useConfigurationStore } from "@/stores/configuration";
import ExternalLink from "@/components/common/ExternalLink.vue";

export default {
  name: "GeneralConfiguration",

  components: {
    BaseInput,
    ExternalLink,
  },

  computed: {
    ...mapState(useConfigurationStore, [
      "customInstructions",
      "allowExecutionOfReadOnlyQueries",
      "alwaysShowDiagnosticQueriesInChat",
      "allowBroadSystemDiagnosticProcedures",
      "deepInvestigationMode",
    ]),
  },

  methods: {
    ...mapActions(useConfigurationStore, ["configure"]),
    handleChange(event: Event) {
      this.configure(
        "customInstructions",
        (event.target as HTMLTextAreaElement).value,
      );
    },
    handleSwitchClick() {
      this.configure("allowExecutionOfReadOnlyQueries", !this.allowExecutionOfReadOnlyQueries);
    },
    handleShowDiagnosticQueriesClick() {
      this.configure(
        "alwaysShowDiagnosticQueriesInChat",
        !this.alwaysShowDiagnosticQueriesInChat,
      );
    },
    handleAllowBroadSystemDiagnosticProceduresClick() {
      this.configure(
        "allowBroadSystemDiagnosticProcedures",
        !this.allowBroadSystemDiagnosticProcedures,
      );
    },
    handleDeepInvestigationModeClick() {
      this.configure(
        "deepInvestigationMode",
        !this.deepInvestigationMode,
      );
    },
  },
};
</script>
