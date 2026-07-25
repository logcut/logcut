#!/usr/bin/env node
/**
 * Runtime dependencies must stay on permissive licenses. Anything outside the
 * allow list (including GPL/AGPL/LGPL/MPL/unknown) fails the build; extending
 * the list requires a manual review.
 *
 * OFL-1.1 covers the bundled @fontsource fonts: it permits bundling and
 * redistribution with the app, and only restricts selling the fonts standalone.
 *
 * The bundled ffmpeg sidecar is LGPL and is not an npm dependency; it is
 * governed separately by scripts/build-ffmpeg-*.sh in apps/desktop.
 */
import { execFileSync } from 'node:child_process'

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'OFL-1.1'
])

const output = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})

const grouped = JSON.parse(output)
const violations = []

for (const [license, packages] of Object.entries(grouped)) {
  if (ALLOWED.has(license)) continue
  for (const pkg of packages) {
    violations.push(`${pkg.name}@${(pkg.versions ?? []).join(',')} — ${license}`)
  }
}

if (violations.length > 0) {
  console.error('Disallowed licenses in runtime dependencies:\n')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(`\nAllowed: ${[...ALLOWED].join(', ')}`)
  process.exit(1)
}

console.log(`License check OK (${Object.keys(grouped).join(', ')})`)
