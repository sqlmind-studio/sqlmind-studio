<template>
  <a @click.prevent="click" :href="href" class="external-link">
    <slot />
  </a>
</template>

<script lang="ts">
import { openExternal } from "@sqlmindstudio/plugin";

export default {
  name: "ExternalLink",

  props: {
    href: {
      type: String,
      required: true,
    },
  },

  methods: {
    click() {
      openExternal(this.href);
    },
  },
};
</script>
