<template>
  <div class="ai-shell-sidebar">
    <div
      v-if="shouldShowUpsell"
      class="sidebar-upsell-wrapper"
    >
      <upsell-content />
    </div>
    <iframe
      v-else
      ref="aiShellFrame"
      :src="aiShellUrl"
      class="ai-shell-iframe"
      frameborder="0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
    ></iframe>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { mapGetters } from "vuex";
import UpsellContent from "@/components/upsell/UpsellContent.vue";

export default Vue.extend({
  name: "AIShellSidebar",
  components: {
    UpsellContent,
  },
  props: {
    hidden: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      aiShellUrl: "",
    };
  },
  computed: {
    ...mapGetters(["isCommunity"]),
    shouldShowUpsell(): boolean {
      return this.isCommunity;
    },
  },
  mounted() {
    // Load the AI Shell plugin using the plugin protocol
    this.aiShellUrl = `bks-plugin://bks-ai-shell/dist/index.html`;
  },
});
</script>

<style lang="scss" scoped>
.ai-shell-sidebar {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-upsell-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow-y: auto;
}

.ai-shell-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
}
</style>
