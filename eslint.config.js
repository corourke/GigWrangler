import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'build/',
      'dev-dist/',
      '.wrangler/',
      'supabase/functions/',
      'node_modules/',
      'public/',
      // website/docs is a separate Astro subproject with its own build
      // output and generated types; it isn't part of this root lint config
      'website/docs/dist/',
      'website/docs/.astro/',
      'website/docs/node_modules/',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Burn-down debt (tracked in docs/development/coding-guide.md):
      // - no-explicit-any: the codebase predates strict typing (~500 `any`s);
      //   tighten to 'error' as services/components are refactored (Phase 7)
      // - the react-hooks v6 compiler rules (set-state-in-effect, immutability,
      //   refs, purity, …) flag real but Phase-7-sized refactors in the large
      //   screen components; re-enable as those components are split
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // Unused function params are idiomatic (callbacks, destructured props);
      // unused locals/imports remain errors
      // B11: a date column is a calendar day; new Date('2026-03-01') is the evening before west
      // of UTC. Use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts).
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=1] > MemberExpression.arguments[property.name=/^(date|due_date|purchase_date|acquisition_date|retired_on|filed_on|tax_date|disposed_on)$/]",
          message: 'A date column is a calendar day: use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts), not new Date().',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=1] > Identifier.arguments[name=/^(dueDate|due_date|purchase_date|purchaseDate|acquisition_date|retired_on|retiredOn|filed_on)$/]",
          message: 'A date column is a calendar day: use parseDateOnly / formatDateOnly (src/utils/dateOnly.ts), not new Date().',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  }
);
