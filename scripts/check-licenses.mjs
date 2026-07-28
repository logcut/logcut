#!/usr/bin/env node
/**
 * Runtime dependencies must stay on permissive licenses. Anything outside the
 * allow list (including GPL/AGPL/LGPL/MPL/unknown) fails the build.
 *
 * **Extending the list requires a manual review**, and each entry already on
 * it has had one — what was reviewed, when, and why it passed is recorded in
 * spec/scripts/check-licenses.md. The bundled ffmpeg sidecar is LGPL, is not
 * an npm dependency, and is governed separately by
 * apps/desktop/scripts/build-ffmpeg-*.sh.
 */
import { execFileSync } from 'node:child_process'

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'OFL-1.1',
  'Python-2.0',
  'BlueOak-1.0.0'
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
