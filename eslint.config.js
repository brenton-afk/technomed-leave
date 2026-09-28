import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

// ─── The one rule that matters here ──────────────────────────────────────────
// `no-undef`, and almost nothing else.
//
// Twice in two days a function was used in api/calendar/today.js and never
// imported. Both were written the same way — an edit added the call and a
// separate edit was meant to add the import — and neither could fail until the
// line actually ran. The first was caught by hand. The second shipped, and the
// first anyone knew of it was Toni being told "parseDateStr is not defined"
// when she checked the bookings.
//
// The test suite could not have caught it: the API handlers run against Gmail,
// Redis and Google, so nothing exercises them, and importing a module does not
// execute the inside of a function. A linter reads the code without running it,
// which is exactly the shape of this problem.
//
// Style rules are deliberately left out. This is a correctness guard, and a
// linter that also argues about semicolons is one people learn to skip.
export default [
  {
    files: ['**/*.js', '**/*.jsx'],
    ignores: ['dist/**', 'node_modules/**', 'public/vendor/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
        React: 'readonly',
        // Substituted at build time by Vite's `define`, so they exist in the
        // bundle and nowhere in the source.
        __APP_COMMIT__: 'readonly',
        __APP_BUILT_AT__: 'readonly'
      }
    },
    // `no-unused-vars` is deliberately absent. Without the React plugin eslint
    // cannot see that a component named in JSX is used, so it reports every one
    // of them — 160 false positives, which is how a linter gets switched off.
    plugins: { 'react-hooks': reactHooks },
    // The exhaustive-deps disables read as unused while that rule is off. They
    // are not stale, so they are not reported.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-undef': 'error',
      // Registered so the `eslint-disable-next-line` comments already in the
      // code refer to a rule that exists, and left off: it is a real rule worth
      // turning on one day, but not in the same change as the guard that had to
      // ship today.
      'react-hooks/exhaustive-deps': 'off'
    }
  }
]
