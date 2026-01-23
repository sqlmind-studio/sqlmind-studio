<template>
  <div class="usage-configuration">
    <h2>Usage</h2>
    
    <!-- AI Usage Panel -->
    <div class="usage-panel-wrapper">
      <AiUsagePanel />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import AiUsagePanel from '@/components/AiUsagePanel.vue';

export default defineComponent({
  name: 'UsageConfiguration',

  components: {
    AiUsagePanel,
  },
});
</script>

<style scoped lang="scss">
.usage-configuration {
  padding: 24px;
  max-width: 800px;

  h2 {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 24px;
    color: #333;
  }
}
</style>
