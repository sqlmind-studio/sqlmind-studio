<template>
  <div
    v-if="error"
    class="error-alert alert text-danger"
  >
    <a
      @click.prevent="$emit('close')"
      v-if="closable"
      class="close-button"
    >
      <i class="material-icons">close</i>
    </a>
    <div class="alert-title">
      <i class="material-icons">error_outline</i>
      <b class="error-title">{{ title || "There was a problem" }}</b>
    </div>
    <div class="alert-body">
      <ul class="error-list">
        <li
          class="error-item"
          v-for="(e, idx) in errors"
          :key="idx"
        >
          <span class="error-text" @click="click(e)" title="Click to copy">
            {{ e.message || e.toString() }}
            {{ e.marker ? ` - line ${e.marker.line}, ch ${e.marker.ch}` : '' }}
            {{ helpText ? ` - ${helpText}` : '' }}
          </span>
        </li>
      </ul>
      <div
        class="help-links"
        v-if="helpLink"
      >
        <a
          :href="helpLink"
          title="Read about this error on the SQLMind Studio docs"
        >Learn more about this error</a>
      </div>
      <div class="ai-fix-section" v-if="showAiFix">
        <button
          class="btn btn-primary btn-sm ai-fix-btn"
          @click.prevent="$emit('fix-with-ai')"
          title="Use AI to analyze and fix this error"
        >
          <i class="material-icons">auto_fix_high</i>
          Fix with AI
        </button>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import _ from 'lodash'
import Vue from 'vue'
export default Vue.extend({
  props: ['error', 'title', 'closable', 'helpText', 'showAiFix'],
  computed: {
    dev() {
      return this.$config.isDevelopment
    },
    errors() {
      const result = _.isArray(this.error) ? this.error : [this.error]
      return result.map((e) => {
        return e.message ? e : { message: e.toString()}
      })
    },
    helpLink() {
      return this.errors.map((e) => e.helpLink).find((e) => e)
    }
  },
  methods: {
    click(e) {
      this.$native.clipboard.writeText(e.message || e.toString())
    }
  }
})
</script>

<style lang="scss" scoped>
  @import '../../assets/styles/app/_variables';

  .alert.error-alert {
    display: flex;
    min-width: 200px;
    flex-direction: column;
    position:relative;
    .close-button {
      position: absolute;
      top: 5px;
      right: 5px;
    }
    .alert-title {
      display: flex;
      flex-direction: row;
      align-items: center;
      i {
        margin-right: 5px;
      }
    }
    .alert-body {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      flex-direction: column;
      flex-grow: 1;
      line-height: 18px;
      padding-top: 6px;
      ul {
        padding-left: 0;
        margin: 0;
      }
      li {
        list-style-type: none;
      }
      .error-text {
        user-select: text;
        cursor: text;
        display: inline-block;
        &:hover {
          background-color: rgba(255, 255, 255, 0.1);
          cursor: pointer;
        }
      }
      i {
        line-height: 28px;
      }
      .help-links {
        margin-top: 1rem;
        a {
          padding-left: 0;
        }
      }
    }

    a {
      font-weight: 600;
      margin-top: calc($gutter-h / 2);
      padding-left: $gutter-w;
    }
    &:hover{
      cursor: pointer;
    }
    
    .ai-fix-section {
      margin-top: 0.75rem;
      .ai-fix-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        font-size: 13px;
        i {
          font-size: 16px;
        }
      }
    }
  }
</style>
