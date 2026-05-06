import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'

const SHIKI_THEME = 'github-light'

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  yml: 'yaml',
  shell: 'bash',
  console: 'bash',
  text: 'plaintext',
  txt: 'plaintext',
}

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighterCore>>
type LanguageRegistrationModule = {
  default: Parameters<ShikiHighlighter['loadLanguage']>
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null
const loadedLanguages = new Set<string>(['plaintext', 'text', 'txt', 'plain'])

const LANGUAGE_LOADERS: Record<string, () => Promise<LanguageRegistrationModule[]>> = {
  bash: () => Promise.all([import('@shikijs/langs/bash')]),
  json: () => Promise.all([import('@shikijs/langs/json')]),
  yaml: () => Promise.all([import('@shikijs/langs/yaml')]),
  markdown: () => Promise.all([import('@shikijs/langs/markdown')]),
  typescript: () => Promise.all([import('@shikijs/langs/typescript')]),
  tsx: () => Promise.all([import('@shikijs/langs/typescript'), import('@shikijs/langs/tsx')]),
  javascript: () => Promise.all([import('@shikijs/langs/javascript')]),
  jsx: () => Promise.all([import('@shikijs/langs/javascript'), import('@shikijs/langs/jsx')]),
  vue: () => Promise.all([
    import('@shikijs/langs/vue'),
    import('@shikijs/langs/html'),
    import('@shikijs/langs/css'),
    import('@shikijs/langs/javascript'),
    import('@shikijs/langs/typescript'),
  ]),
  html: () => Promise.all([import('@shikijs/langs/html')]),
  css: () => Promise.all([import('@shikijs/langs/css')]),
  diff: () => Promise.all([import('@shikijs/langs/diff')]),
  sql: () => Promise.all([import('@shikijs/langs/sql')]),
}

export function normalizeCodeLanguage(language?: string): string {
  if (!language) return 'plaintext'
  const normalized = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] || normalized
}

export function getShikiTheme(): string {
  return SHIKI_THEME
}

export async function getShikiHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('@shikijs/themes/github-light'),
    ]).then(([githubLight]) =>
      createHighlighterCore({
        engine: createJavaScriptRegexEngine(),
        themes: [githubLight.default],
      })
    )
  }

  return highlighterPromise
}

export async function ensureShikiLanguage(language?: string): Promise<string> {
  const normalized = normalizeCodeLanguage(language)
  if (loadedLanguages.has(normalized)) {
    return normalized
  }

  const loader = LANGUAGE_LOADERS[normalized]
  if (!loader) {
    return 'plaintext'
  }

  const highlighter = await getShikiHighlighter()
  const modules = await loader()
  await highlighter.loadLanguage(...modules.flatMap(module => module.default))
  loadedLanguages.add(normalized)
  return normalized
}
