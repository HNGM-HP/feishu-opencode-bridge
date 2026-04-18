import { computed, ref, watch } from 'vue'
import enUS from 'element-plus/es/locale/lang/en'
import zhCN from 'element-plus/es/locale/lang/zh-cn'
import { EN_TRANSLATION_MAP, EN_TRANSLATION_PATTERNS } from './packs/en'

export type AppLocale = 'zh-CN' | 'en-US'

const LOCALE_STORAGE_KEY = 'opencode_bridge_locale'
const TEXT_SKIP_SELECTOR = [
  '[data-i18n-skip]',
  '.markdown-body',
  '.code-block',
  '.code-content',
  '.streaming-message',
  '.tree-label',
  '.create-dialog-path',
  '.branch-name',
  '.branch-option',
  '.tree-item__path',
  '.timeline-node__msg',
  '.detail-card__title',
  '.info-value--mono',
  '.job-id',
  '.job-name',
  '.log-message',
  '.log-source',
  '.session-meta',
  '.session-dir',
  '.title-text',
  '.wxid',
  'pre',
  'code',
  '.terminal-stream',
  '.prompt-command',
  '.prompt-path',
].join(', ')

const ATTRIBUTE_SKIP_SELECTOR = [
  '[data-i18n-skip]',
  '.markdown-body',
  '.code-block',
  '.code-content',
  '.create-dialog-path',
  '.job-id',
  '.job-name',
  '.log-message',
  '.log-source',
  '.session-meta',
  '.session-dir',
  '.title-text',
  '.wxid',
  '.terminal-stream',
].join(', ')

const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'] as const
const sortedTranslationEntries = Object.entries(EN_TRANSLATION_MAP).sort((left, right) => right[0].length - left[0].length)

const textOriginals = new WeakMap<Text, string>()
const attributeOriginals = new WeakMap<HTMLElement, Map<string, string>>()

function loadInitialLocale(): AppLocale {
  if (typeof window === 'undefined') {
    return 'zh-CN'
  }

  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  return saved === 'en-US' ? 'en-US' : 'zh-CN'
}

export const appLocale = ref<AppLocale>(loadInitialLocale())

export const elementPlusLocale = computed(() => appLocale.value === 'en-US' ? enUS : zhCN)

export function setAppLocale(nextLocale: AppLocale): void {
  appLocale.value = nextLocale === 'en-US' ? 'en-US' : 'zh-CN'
}

export function getActiveDateLocale(): string {
  return appLocale.value === 'en-US' ? 'en-US' : 'zh-CN'
}

export function isEnglishLocale(): boolean {
  return appLocale.value === 'en-US'
}

function translateToEnglish(source: string): string {
  if (!source) {
    return source
  }

  let output = source
  for (const [zhText, enText] of sortedTranslationEntries) {
    if (output.includes(zhText)) {
      output = output.split(zhText).join(enText)
    }
  }

  for (const pattern of EN_TRANSLATION_PATTERNS) {
    output = output.replace(pattern.regex, (...args) => pattern.replace(...(args as string[])))
  }

  return output
}

export function translateUiText(source: string): string {
  return appLocale.value === 'en-US' ? translateToEnglish(source) : source
}

function syncDocumentLanguage(): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = appLocale.value === 'en-US' ? 'en' : 'zh-CN'
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement
  return Boolean(parent?.closest(TEXT_SKIP_SELECTOR))
}

function shouldSkipAttribute(element: HTMLElement): boolean {
  return Boolean(element.closest(ATTRIBUTE_SKIP_SELECTOR))
}

function translateTextNode(node: Text): void {
  if (shouldSkipTextNode(node)) {
    return
  }

  const currentValue = node.nodeValue ?? ''
  const previousOriginal = textOriginals.get(node)
  if (!previousOriginal || currentValue !== translateToEnglish(previousOriginal)) {
    textOriginals.set(node, currentValue)
  }

  const original = textOriginals.get(node) ?? currentValue
  const nextValue = translateUiText(original)
  if (currentValue !== nextValue) {
    node.nodeValue = nextValue
  }
}

function translateElementAttributes(element: HTMLElement): void {
  if (shouldSkipAttribute(element)) {
    return
  }

  let originals = attributeOriginals.get(element)
  if (!originals) {
    originals = new Map<string, string>()
    attributeOriginals.set(element, originals)
  }

  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const currentValue = element.getAttribute(attribute)
    if (currentValue == null) {
      originals.delete(attribute)
      continue
    }

    const previousOriginal = originals.get(attribute)
    if (!previousOriginal || currentValue !== translateToEnglish(previousOriginal)) {
      originals.set(attribute, currentValue)
    }

    const original = originals.get(attribute) ?? currentValue
    const nextValue = translateUiText(original)
    if (currentValue !== nextValue) {
      element.setAttribute(attribute, nextValue)
    }
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text)
    return
  }

  if (root.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = root as HTMLElement
  translateElementAttributes(element)
  for (const child of Array.from(element.childNodes)) {
    translateTree(child)
  }
}

let observer: MutationObserver | null = null
let syncing = false
let initialized = false

export function installRuntimeLocaleOverlay(): void {
  if (typeof document === 'undefined' || initialized) {
    return
  }

  initialized = true
  syncDocumentLanguage()

  const runSync = (target?: Node): void => {
    syncing = true
    try {
      translateTree(target ?? document.body)
    } finally {
      syncing = false
    }
  }

  observer = new MutationObserver(records => {
    if (syncing) {
      return
    }

    for (const record of records) {
      if (record.type === 'characterData') {
        runSync(record.target)
        continue
      }

      if (record.type === 'attributes') {
        runSync(record.target)
        continue
      }

      if (record.type === 'childList') {
        for (const addedNode of Array.from(record.addedNodes)) {
          runSync(addedNode)
        }
      }
    }
  })

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
  })

  watch(
    appLocale,
    locale => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
      }
      syncDocumentLanguage()
      runSync()
    },
    { immediate: true }
  )
}
