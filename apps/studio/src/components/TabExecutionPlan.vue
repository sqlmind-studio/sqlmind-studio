<template>
  <div class="execution-plan" ref="container">
    <!-- Paste area only shown in standalone viewer -->
    <div v-if="showPasteArea" class="paste-wrap">
      <textarea v-model="pasteXml" class="paste" placeholder="Paste <ShowPlanXML ...> here"></textarea>
      <div class="actions">
        <button class="btn btn-primary" @click="renderFromPaste" :disabled="!pasteXml.trim()">Render Plan</button>
        <button class="btn" @click="clearPaste" v-if="pasteXml">Clear</button>
      </div>
    </div>
    
    <!-- Message or plan container below -->
    <div v-if="!hasPlan" class="message">
      <div class="alert alert-info">
        <i class="material-icons-outlined">info</i>
        <span>No execution plan available{{ showPasteArea ? '. Paste a plan XML above to preview' : '' }}.</span>
      </div>
    </div>
    <div v-else class="plan-container" ref="planRoot"></div>
    
    <!-- Only show StatusBar in standalone viewer, not when embedded in query editor -->
    <status-bar v-if="showPasteArea" :active="active">
      <div class="statusbar-info col flex expand">
        <span class="statusbar-item">
          <i class="material-icons">account_tree</i>
          <span>Execution Plan Viewer</span>
        </span>
      </div>
    </status-bar>
  </div>
</template>

<script>
import qpXslt from '../../../../plugin/html-query-plan-2.6.1/src/qp.xslt?raw'
import StatusBar from './common/StatusBar.vue'
import '../../../../plugin/html-query-plan-2.6.1/css/qp.css'
import * as qpXml from '../../../../plugin/html-query-plan-2.6.1/src/xml'
import { drawLines } from '../../../../plugin/html-query-plan-2.6.1/src/lines'
import { initTooltip } from '../../../../plugin/html-query-plan-2.6.1/src/tooltip'

export default {
  name: 'TabExecutionPlan',
  components: {
    StatusBar
  },
  props: {
    tab: { type: Object, required: true },
    active: { type: Boolean, default: false },
    showPasteArea: { type: Boolean, default: false }, // Only show in standalone viewer
  },
  data() {
    return {
      pasteXml: '',
      lastRendered: '',
    }
  },
  computed: {
    planXml() {
      const xml = (this.tab && this.tab.planXml) || ''
      console.log(`[TabExecutionPlan] planXml computed: length=${xml.length}, hasPlan=${!!(xml && xml.trim().length)}`)
      return xml
    },
    hasPlan() {
      const has = !!(this.planXml && this.planXml.trim().length)
      console.log(`[TabExecutionPlan] hasPlan computed: ${has}`)
      return has
    }
  },
  watch: {
    active(val) {
      console.log(`[TabExecutionPlan] active changed to: ${val}`)
      if (val) this.$nextTick(this.renderIfNeeded)
    },
    planXml(newVal, oldVal) {
      console.log(`[TabExecutionPlan] planXml watcher triggered: oldLength=${oldVal?.length || 0}, newLength=${newVal?.length || 0}`)
      // If plan was cleared, immediately clear the DOM
      if (!newVal || newVal.trim().length === 0) {
        console.log('[TabExecutionPlan] Plan cleared, clearing DOM immediately')
        const root = this.$refs.planRoot
        if (root) {
          while (root.firstChild) root.removeChild(root.firstChild)
        }
        this.lastRendered = ''
      }
      this.$nextTick(this.renderIfNeeded)
    }
  },
  mounted() {
    this.renderIfNeeded()
  },
  methods: {
    renderIfNeeded() {
      console.log(`[TabExecutionPlan] renderIfNeeded called: active=${this.active}, hasPlan=${this.hasPlan}, planXmlLength=${this.planXml?.length || 0}`)
      
      if (!this.active) return
      
      // If plan is cleared, reset lastRendered to allow re-rendering when plan is available again
      if (!this.hasPlan) {
        console.log('[TabExecutionPlan] No plan available, resetting lastRendered')
        this.lastRendered = ''
        return
      }
      
      if (this.lastRendered === this.planXml) {
        console.log('[TabExecutionPlan] Plan already rendered, skipping')
        return
      }
      
      const root = this.$refs.planRoot
      if (!root) {
        console.log('[TabExecutionPlan] planRoot ref not available')
        return
      }
      
      try {
        console.log('[TabExecutionPlan] Rendering new plan')
        while (root.firstChild) root.removeChild(root.firstChild)
        qpXml.setContentsUsingXslt(root, this.planXml, qpXslt)
        drawLines(root)
        initTooltip(root)
        this.lastRendered = this.planXml
        console.log('[TabExecutionPlan] Plan rendered successfully')
      } catch (e) {
        console.error('[TabExecutionPlan] Failed to render execution plan', e)
      }
    },
    renderFromPaste() {
      const xml = (this.pasteXml || '').trim()
      if (!xml) return
      this.$set(this.tab, 'planXml', xml)
      this.pasteXml = ''
    },
    clearPaste() {
      this.pasteXml = ''
    }
  }
}
</script>

<style scoped>
.execution-plan {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--theme-bg);
}
.paste-wrap {
  flex: 0 0 auto;
  padding: 12px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-bg);
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.paste {
  flex: 1 1 auto;
  min-height: 80px;
  max-height: 120px;
  resize: vertical;
  font-family: monospace;
  font-size: 12px;
}
.actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.message {
  padding: 20px;
}
.plan-container {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-bottom: 2.6rem; /* Reserve space for status bar */
}
</style>

<style>
/* Ensure sufficient contrast inside the HTML Query Plan regardless of app theme */
.execution-plan .qp-root,
.execution-plan .qp-node,
.execution-plan .qp-node *,
.execution-plan .qp-statement-header,
.execution-plan .qp-statement-header * {
  color: #111 !important; /* dark text over light node backgrounds */
}

/* CRITICAL: Force tooltip text to be dark and readable in all themes */
/* Tooltips are appended to body, so we need global selectors */
.qp-tt,
.qp-tt *,
.qp-tt td,
.qp-tt th,
.qp-tt tr,
.qp-tt span,
.qp-tt div,
.qp-tt p,
.qp-tt a,
.qp-tt table,
.qp-tt tbody {
  color: #000000 !important; /* Pure black text for maximum contrast */
  background-color: #ffffff !important; /* Pure white background */
  opacity: 1 !important; /* Ensure no transparency */
}

/* Also ensure table borders/tooltips remain visible */
.qp-tt td,
.qp-tt th {
  border-color: #000 !important;
  border-width: 1px !important;
  border-style: solid !important;
}

/* Ensure tooltip container has white background */
.qp-tt {
  background-color: #ffffff !important;
  z-index: 9999 !important; /* Ensure tooltip appears above other elements */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important; /* Add shadow for better visibility */
  position: absolute !important; /* Required for positioning */
}
</style>
