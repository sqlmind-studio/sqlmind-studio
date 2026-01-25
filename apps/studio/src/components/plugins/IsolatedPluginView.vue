<template>
  <div class="isolated-plugin-view" ref="container">
    <div v-if="shouldShowUpsell" class="plugin-upsell-wrapper">
      <upsell-content />
    </div>
    <div v-else-if="$bksConfig.plugins?.[pluginId]?.disabled" class="alert">
      <i class="material-icons-outlined">info</i>
      <div>This plugin ({{ pluginId }}) has been disabled via configuration</div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue, { PropType } from "vue";
import { LoadViewParams } from "@sqlmindstudio/plugin";
import { ThemeChangedNotification } from "@sqlmindstudio/plugin";
import { mapGetters } from "vuex";
import UpsellContent from "@/components/upsell/UpsellContent.vue";

export default Vue.extend({
  name: "IsolatedPluginView",
  components: {
    UpsellContent,
  },
  props: {
    visible: {
      type: Boolean,
      default: true,
    },
    keepAlive: {
      type: Boolean,
      default: true,
    },
    pluginId: {
      type: String,
      required: true,
    },
    command: String,
    params: null as PropType<LoadViewParams>,
    url: {
      type: String,
      required: true,
    },
    onRequest: Function,
    reload: null,
  },
  data() {
    return {
      loaded: false,
      mounted: false,
      // Use a timestamp parameter to force iframe refresh
      timestamp: Date.now(),
      unsubscribe: null,
      unsubscribeOnReady: null,
      unsubscribeOnDispose: null,
      iframe: null,
    };
  },
  computed: {
    ...mapGetters(["isCommunity"]),
    shouldShowUpsell(): boolean {
      // Show upsell if user is on community edition AND plugin is AI Shell
      return this.isCommunity && this.pluginId === 'bks-ai-shell';
    },
    _separator() {
      return String(this.url || '').includes('?') ? '&' : '?'
    },
    baseUrl() {
      // FIXME move this somewhere
      return `${this.url}${this._separator}timestamp=${this.timestamp}`;
    },
    shouldMountIframe() {
      if (!this.keepAlive) {
        return this.visible && this.loaded && !this.shouldShowUpsell;
      }

      // If it's already mounted, do not unmount it unless it's not loaded
      if (this.mounted) {
        return this.loaded;
      }
      return this.visible && this.loaded && !this.shouldShowUpsell;
    },
  },
  watch: {
    reload() {
      this.timestamp = Date.now();
    },
    shouldMountIframe: {
      async handler() {
        await this.$nextTick();
        if (this.shouldMountIframe) {
          this.mountIframe();
        } else {
          this.unmountIframe();
        }
      },
      immediate: true,
    },
  },
  methods: {
    mountIframe() {
      if (this.iframe) {
        return;
      }

      const iframe = document.createElement("iframe");
      // Add cache-busting parameter to force reload
      const cacheBuster = Date.now();
      iframe.src = `${this.baseUrl}&v=${cacheBuster}`;
      iframe.sandbox = "allow-scripts allow-same-origin allow-forms allow-modals";
      iframe.allow = "microphone; clipboard-read; clipboard-write;";
      
      // Set iframe style to prevent white flash - match app theme background
      // Make iframe transparent so host background shows through
      iframe.style.backgroundColor = 'transparent';
      iframe.style.border = 'none';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.colorScheme = 'dark';
      iframe.style.opacity = '0';
      iframe.style.transition = 'opacity 0.15s ease-in';

      // HACK(azmi): Trigger an initial `themeChanged` notification because
      // older versions of AI Shell don't automatically handle theme state on load.
      iframe.onload = () => {
        // Fade in the iframe after it loads
        setTimeout(() => {
          if (iframe) {
            iframe.style.opacity = '1';
          }
        }, 50);
        
        const loader = this.$plugin?.loaders?.get(this.pluginId);
        if (loader) {
          this.$plugin.notify(this.pluginId, {
            name: "themeChanged",
            args: loader.context.store.getTheme(),
          } as ThemeChangedNotification);
        }
      };

      this.$plugin.registerIframe(
        this.pluginId,
        iframe,
        { command: this.command, params: this.params }
      );
      this.unsubscribe = this.$plugin.onViewRequest(this.pluginId, (args) => {
        if (args.source === iframe) {
          this.onRequest?.(args);
        }
      });
      this.$refs.container.appendChild(iframe);
      this.iframe = iframe;
      this.mounted = true;
    },
    unmountIframe() {
      if (!this.iframe) {
        return;
      }

      this.$plugin.unregisterIframe(this.pluginId, this.iframe);
      this.unsubscribe?.();
      this.iframe.remove();
      this.iframe = null;
      this.mounted = false;
    },
    handleError(e) {
      console.error(`${this.pluginId} iframe error`, e);
    }
  },
  mounted() {
    this.unsubscribeOnReady = this.$plugin.onReady(this.pluginId, () => {
      this.loaded = true;
    });
    this.unsubscribeOnDispose = this.$plugin.onDispose(this.pluginId, () => {
      this.loaded = false;
    })
  },
  beforeDestroy() {
    this.unsubscribeOnReady?.();
    this.unsubscribeOnDispose?.();
    this.unmountIframe();
  },
});
</script>

<style lang="scss" scoped>
.isolated-plugin-view {
  height: 100%;
  width: 100%;
  background-color: var(--theme-bg);
  
  // Ensure iframes also have dark background - match JSON Viewer
  :deep(iframe) {
    background-color: transparent;
  }
}

.plugin-upsell-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  overflow-y: auto;
}
</style>
