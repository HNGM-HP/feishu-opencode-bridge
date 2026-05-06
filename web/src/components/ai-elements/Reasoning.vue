<template>
  <section class="reasoning-card">
    <button type="button" class="reasoning-toggle" @click="expanded = !expanded">
      <div>
        <span class="eyebrow">{{ title }}</span>
        <div class="preview">{{ expanded ? '收起推理过程' : preview }}</div>
      </div>
      <span class="chevron">{{ expanded ? '−' : '+' }}</span>
    </button>

    <transition name="fade-slide">
      <div v-if="expanded" class="reasoning-body">
        <template v-for="segment in segments" :key="segment.id">
          <div v-if="segment.type === 'markdown'" class="reasoning-text" v-html="renderMarkdown(segment.content)" />
          <div v-else class="reasoning-code">
            <div class="code-lang">{{ segment.language || 'code' }}</div>
            <pre><code>{{ segment.code }}</code></pre>
          </div>
        </template>
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { splitMarkdownSegments } from './markdown-utils'

const props = withDefaults(defineProps<{
  source: string
  title?: string
}>(), {
  title: 'Reasoning',
})

const expanded = ref(false)

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const preview = computed(() => {
  const compact = props.source.replace(/\s+/g, ' ').trim()
  if (!compact) return '没有可展示的推理内容'
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact
})

const segments = computed(() => splitMarkdownSegments(props.source))

function renderMarkdown(source: string): string {
  return md.render(source || '')
}
</script>

<style scoped>
.reasoning-card {
  margin-top: 14px;
  border-radius: 18px;
  border: 1px solid rgba(191, 219, 254, 0.86);
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(240, 249, 255, 0.96));
}

.reasoning-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 14px;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}

.eyebrow {
  display: block;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  color: #0f766e;
}

.preview {
  margin-top: 4px;
  color: #42536d;
  font-size: 13px;
}

.chevron {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
  font-size: 18px;
  flex-shrink: 0;
}

.reasoning-body {
  padding: 0 14px 14px;
  display: grid;
  gap: 10px;
}

.reasoning-text {
  color: #334155;
  line-height: 1.7;
  font-size: 13px;
  word-break: break-word;
}

.reasoning-text :deep(:first-child) { margin-top: 0; }
.reasoning-text :deep(:last-child) { margin-bottom: 0; }
.reasoning-text :deep(p) { margin: 0 0 8px; }
.reasoning-text :deep(ul), .reasoning-text :deep(ol) { padding-left: 1.2rem; margin: 0 0 8px; }
.reasoning-text :deep(code) {
  padding: 0.12rem 0.35rem;
  border-radius: 0.4rem;
  background: rgba(15, 23, 42, 0.08);
  color: #9a3412;
  font-size: 0.9em;
}

.reasoning-code {
  border-radius: 14px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.96);
}

.code-lang {
  padding: 6px 12px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(226, 232, 240, 0.7);
  font-weight: 700;
  background: rgba(2, 6, 23, 0.6);
}

.reasoning-code pre {
  margin: 0;
  padding: 12px;
  color: #dbeafe;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-color-scheme: dark) {
  .reasoning-card {
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(14, 34, 49, 0.94));
    border-color: rgba(96, 165, 250, 0.2);
  }

  .eyebrow { color: #2dd4bf; }
  .preview { color: #93a5bc; }
  .chevron { background: rgba(45, 212, 191, 0.14); color: #2dd4bf; }
  .reasoning-text { color: #b8cce0; }
  .reasoning-text :deep(code) { background: rgba(255, 255, 255, 0.08); color: #fb923c; }
}
</style>
