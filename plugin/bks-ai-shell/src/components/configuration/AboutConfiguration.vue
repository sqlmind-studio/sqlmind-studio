<template>
  <h2>About</h2>
  <ul>
    <li>AI Mode: Enabled</li>
    <li>Version {{ version }}</li>
    <li>
      <ExternalLink href="https://sqltools.co/" class="github-link">
        Visit SQLTools Website
      </ExternalLink>
    </li>
    <li>Developed by the SQLMind Studio team</li>
  </ul>
</template>

<script lang="ts">
import manifest from "../../../manifest.json";
import ExternalLink from "../common/ExternalLink.vue";

export default {
  name: "AboutConfiguration",

  components: {
    ExternalLink,
  },

  data() {
    return {
      version: manifest.version,
    };
  },
};
</script>
