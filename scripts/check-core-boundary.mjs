#!/usr/bin/env node
/**
 * Enforce the @logcut/core boundary.
 *
 * The editing core is the one piece shared by every client — the desktop app
 * today, the web app and AI-driven callers later — so it must stay pure: no
 * runtime dependencies, no Node builtins, no DOM, no I/O. It describes edits
 * and produces plans; executing them is the shell's job.
 *
 * Run with `pnpm check:core`. Also runs in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORE = join(ROOT, 'packages/core')

/** Platform globals the core must never touch. */
const BANNED_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'XMLHttpRequest',
  'WebSocket',
  'process'
]

/** The only Node builtins a core test file may import. */
const TEST_ONLY_BUILTINS = /^node:(test|assert)/

const errors = []

function fail(location, message) {
  errors.push(`${location}: ${message}`)
}

// 1. No runtime dependencies. Anything the core needs must be passed in.
const pkg = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8'))
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  const names = Object.keys(pkg[field] ?? {})
  if (names.length > 0) {
    fail('packages/core/package.json', `"${field}" must stay empty, found: ${names.join(', ')}`)
  }
}

// 2. No platform imports or globals in the sources.
function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

for (const file of walk(join(CORE, 'src'))) {
  const location = relative(ROOT, file)
  const isTest = file.endsWith('.test.ts')
  const lines = readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, index) => {
    const at = `${location}:${index + 1}`
    const match = line.match(/from\s+'([^']+)'|require\(\s*'([^']+)'\s*\)/)
    if (match) {
      const specifier = match[1] ?? match[2]
      if (specifier.startsWith('node:')) {
        if (!isTest || !TEST_ONLY_BUILTINS.test(specifier)) {
          fail(at, `imports the Node builtin "${specifier}"`)
        }
      } else if (!specifier.startsWith('.')) {
        fail(at, `imports the external module "${specifier}"`)
      }
    }
    for (const name of BANNED_GLOBALS) {
      if (new RegExp(`\\b${name}\\s*[.\\[(]`).test(line)) {
        fail(at, `uses the platform global "${name}"`)
      }
    }
    if (/\bfetch\s*\(/.test(line)) fail(at, 'performs I/O via fetch()')
  })
}

if (errors.length > 0) {
  console.error('@logcut/core boundary violations:\n')
  for (const error of errors) console.error(`  ${error}`)
  console.error(
    '\nThe core stays platform neutral so the desktop app, the web app, and AI\n' +
      'callers can all share it. Move platform work into the consuming app.'
  )
  process.exit(1)
}

console.log('@logcut/core boundary OK')
