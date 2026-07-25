import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  configCacheKey,
  defaultOption,
  isTraditionalLocale,
  languageOptionToConfig,
  orderedOptions
} from './language.ts'

test('languageOptionToConfig maps each option to the right ASR params', () => {
  assert.deepEqual(languageOptionToConfig('auto'), {})
  assert.deepEqual(languageOptionToConfig('simplified'), {})
  assert.deepEqual(languageOptionToConfig('english'), { language: 'en-US' })
  assert.deepEqual(languageOptionToConfig('traditional'), { zhVariant: 'tw' })
})

test('configCacheKey collapses auto and simplified to the same key', () => {
  assert.equal(configCacheKey(languageOptionToConfig('auto')), '|')
  assert.equal(configCacheKey(languageOptionToConfig('simplified')), '|')
  assert.equal(configCacheKey(languageOptionToConfig('english')), 'en-US|')
  assert.equal(configCacheKey(languageOptionToConfig('traditional')), '|tw')
})

test('isTraditionalLocale recognizes Taiwan/HK/Macau/Hant, not simplified', () => {
  for (const locale of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW']) {
    assert.equal(isTraditionalLocale(locale), true, locale)
  }
  for (const locale of ['zh-CN', 'zh-Hans', 'zh', 'en-US', '']) {
    assert.equal(isTraditionalLocale(locale), false, locale)
  }
})

test('orderedOptions leads with the system-language default', () => {
  assert.deepEqual(orderedOptions('zh-CN'), ['auto', 'english', 'simplified', 'traditional'])
  assert.deepEqual(orderedOptions('en-US'), ['auto', 'english', 'simplified', 'traditional'])
  assert.deepEqual(orderedOptions('zh-TW'), ['traditional', 'simplified', 'auto', 'english'])
})

test('defaultOption is traditional only for Traditional-Chinese systems', () => {
  assert.equal(defaultOption('zh-TW'), 'traditional')
  assert.equal(defaultOption('zh-CN'), 'auto')
  assert.equal(defaultOption('en-US'), 'auto')
})
