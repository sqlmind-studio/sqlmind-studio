<template>
  <div class="ai-mode-upsell">
    <div class="upsell-content">
      <span class="title">
        <i class="material-symbols-outlined">auto_awesome</i> AI Mode
      </span>
      <div class="body">
        <p>
          <strong>Upgrade required to use AI Mode.</strong>
        </p>
        <p>
          Ask AI to analyze your database and generate SQL queries. Get expert DBA assistance powered by advanced AI models.
        </p>
        <ul class="features">
          <li>✨ Natural language to SQL conversion</li>
          <li>🔍 Database schema analysis</li>
          <li>⚡ Query optimization suggestions</li>
          <li>🤖 Multiple AI providers (OpenAI, Anthropic, Google)</li>
        </ul>
      </div>
      <div class="actions">
        <button class="btn btn-flat" @click="startTrial">Start Free Trial</button>
        <button class="btn btn-primary" @click="buyLicense">Buy License</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AIModeUpsell',
  methods: {
    startTrial() {
      // This would be handled by the parent app
      this.$emit('start-trial');
    },
    buyLicense() {
      // This would be handled by the parent app
      this.$emit('buy-license');
    }
  }
});
</script>

<style scoped>
.ai-mode-upsell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
  background: var(--bg-color, #1e1e1e);
}

.upsell-content {
  max-width: 500px;
  text-align: center;
}

.title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

.title i {
  font-size: 2rem;
  color: var(--theme-primary, #6c5ce7);
}

.body {
  margin-bottom: 2rem;
}

.body p {
  margin-bottom: 1rem;
  line-height: 1.6;
}

.features {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0;
  text-align: left;
}

.features li {
  padding: 0.5rem 0;
  font-size: 0.95rem;
}

.actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 2rem;
}

.btn {
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-flat {
  background: transparent;
  border: 1px solid var(--theme-primary, #6c5ce7);
  color: var(--theme-primary, #6c5ce7);
}

.btn-flat:hover {
  background: rgba(108, 92, 231, 0.1);
}

.btn-primary {
  background: var(--theme-primary, #6c5ce7);
  color: white;
}

.btn-primary:hover {
  background: var(--theme-primary-dark, #5b4cdb);
}
</style>
