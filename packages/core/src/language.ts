import type { LanguageOption, TranscribeConfig } from './types.ts'

/** Map a language option to the ASR request parameters. */
export function languageOptionToConfig(option: LanguageOption): TranscribeConfig {
  switch (option) {
    case 'english':
      return { language: 'en-US' }
    case 'traditional':
      return { zhVariant: 'tw' }
    case 'auto':
    case 'simplified':
    default:
      // Both leave language empty (mixed zh/en) with simplified output.
      return {}
  }
}

/**
 * Stable key for cache comparison. `auto` and `simplified` map to the same
 * request and therefore the same key, so switching between them reuses cache.
 */
export function configCacheKey(config: TranscribeConfig): string {
  return `${config.language ?? ''}|${config.zhVariant ?? ''}`
}

/** True for Traditional-Chinese system locales (Taiwan, Hong Kong, Macau, Hant). */
export function isTraditionalLocale(locale: string): boolean {
  return /^zh/i.test(locale) && /hant|tw|hk|mo/i.test(locale)
}

/** Option order for the dropdown, Traditional-Chinese systems lead with traditional. */
export function orderedOptions(locale: string): LanguageOption[] {
  return isTraditionalLocale(locale)
    ? ['traditional', 'simplified', 'auto', 'english']
    : ['auto', 'english', 'simplified', 'traditional']
}

/** First-run default when no preference is saved. */
export function defaultOption(locale: string): LanguageOption {
  return isTraditionalLocale(locale) ? 'traditional' : 'auto'
}
