import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint scope is deliberately narrow: React hook correctness in the renderer,
 * and nothing else. TypeScript in strict mode already catches what a general
 * rule set would, so the only rules earning their maintenance here are the two
 * a type checker cannot express — hook call order and dependency arrays.
 *
 * The plugin's `recommended` preset also carries the React Compiler rules.
 * They are left off on purpose: `set-state-in-effect` flags the ordinary
 * "kick off an async load from an effect" pattern, where setState happens
 * after an await rather than synchronously, and silencing it would mean
 * rewriting correct code.
 */
export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'vendor/**'] },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
)
