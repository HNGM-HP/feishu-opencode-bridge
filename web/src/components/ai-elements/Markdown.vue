<template>
  <div
    v-if="renderedHtml"
    class="markdown-body"
    data-i18n-skip
    v-html="renderedHtml"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

const props = defineProps<{
  source: string
}>()

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
})

const originalLinkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any,
) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noreferrer noopener')
  if (originalLinkOpen) {
    return originalLinkOpen(tokens, idx, options, env, self)
  }
  return self.renderToken(tokens, idx, options)
}

const renderedHtml = computed(() => {
  const source = props.source?.trim()
  if (!source) return ''
  return markdown.render(source)
})
</script>

<style scoped>
.markdown-body {
  color: #16304d;
  line-height: 1.72;
  word-break: break-word;
}

.markdown-body :deep(:first-child) {
  margin-top: 0;
}

.markdown-body :deep(:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(table) {
  margin: 0 0 12px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.35rem;
}

.markdown-body :deep(li + li) {
  margin-top: 4px;
}

.markdown-body :deep(blockquote) {
  padding: 10px 14px;
  border-left: 3px solid rgba(13, 148, 136, 0.48);
  border-radius: 0 14px 14px 0;
  background: rgba(240, 249, 255, 0.9);
  color: #37506b;
}

.markdown-body :deep(code) {
  padding: 0.14rem 0.38rem;
  border-radius: 0.45rem;
  background: rgba(15, 23, 42, 0.08);
  color: #9a3412;
  font-size: 0.92em;
}

.markdown-body :deep(a) {
  color: #0f766e;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 0.9);
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.92);
  text-align: left;
}

.markdown-body :deep(th) {
  background: rgba(241, 245, 249, 0.96);
  font-weight: 700;
}

@media (prefers-color-scheme: dark) {
  .markdown-body {
    color: #d9e4ef;
  }

  .markdown-body :deep(code) {
    background: rgba(255, 255, 255, 0.08);
    color: #fb923c;
  }

  .markdown-body :deep(blockquote) {
    background: rgba(30, 41, 59, 0.6);
    border-left-color: rgba(45, 212, 191, 0.48);
    color: #b8cce0;
  }

  .markdown-body :deep(a) {
    color: #2dd4bf;
  }

  .markdown-body :deep(table) {
    border-color: rgba(148, 163, 184, 0.2);
  }

  .markdown-body :deep(th) {
    background: rgba(30, 41, 59, 0.8);
    color: #d9e4ef;
  }

  .markdown-body :deep(td) {
    border-bottom-color: rgba(148, 163, 184, 0.14);
  }
}
</style>
