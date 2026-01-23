<template>
  <form @submit.prevent class="config-form">
    <h2 id="providers-configuration-api-keys">API Keys</h2>
    <ApiInfo />
    <api-key-form />
  </form>
</template>

<script lang="ts">
import ApiKeyForm from "@/components/ApiKeyForm.vue";
import ApiInfo from "@/components/configuration/ApiInfo.vue";

export default {
  name: "ProvidersConfiguration",

  components: {
    ApiKeyForm,
    ApiInfo,
  },
};
</script>
