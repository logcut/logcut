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
  { ignores: ['out/**', 'release/**', 'release-zip/**', 'vendor/**'] },
  {
    /**
     * Every source file is parsed through the TypeScript project service —
     * the same resolution a language server performs. A file belonging to no
     * tsconfig fails here with "was not found by the project service", which
     * is precisely the gap `pnpm typecheck` cannot see: it passes an explicit
     * `-p` per project, so it covers files the editor would silently hand to
     * an inferred project (no strict, no jsx, no lib, no path aliases) and
     * report phantom errors on. This block carries no rules — the parse is
     * the check.
     */
    files: ['src/**/*.{ts,tsx}', '*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
)
