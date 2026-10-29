import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.js', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The domain does not depend on frameworks or outer layers.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*', 'pg', 'express', 'zod'], message: 'The domain does not import frameworks.' },
            { group: ['**/application/**', '**/infra/**', '**/main/**'], message: 'The domain does not know the outer layers.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pg', 'express'], message: 'The application depends on interfaces, not drivers.' },
            { group: ['**/infra/**', '**/main/**'], message: 'The application does not know the outer layers.' },
          ],
        },
      ],
    },
  },
);
