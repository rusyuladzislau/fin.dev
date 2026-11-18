// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const boundaries = require('eslint-plugin-boundaries');

/**
 * Every cross-slice dependency must use the slice's public index.ts.
 * @param {string[]} types
 */
function publicEntryPoints(types) {
  return types.map((type) => ({
    element: { type, fileInternalPath: 'index.ts' },
  }));
}

/**
 * @param {string} from
 * @param {string[]} allowedTypes
 */
function allowPublicDependencies(from, allowedTypes) {
  return {
    from: { element: { type: from } },
    allow: { to: publicEntryPoints(allowedTypes) },
  };
}

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'page', pattern: 'src/pages/*' },
        { type: 'feature', pattern: 'src/features/*/*' },
        { type: 'entity', pattern: 'src/entities/*' },
        { type: 'shared', pattern: 'src/shared/ui/*' },
      ],
      'boundaries/files': [{ pattern: 'src/**/*.spec.ts', category: 'test' }],
    },
    rules: {
      ...boundaries.configs.recommended.rules,
      'boundaries/no-unknown-dependencies': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkInternals: true,
          policies: [
            {
              allow: { dependency: { relationship: { to: 'internal' } } },
            },
            allowPublicDependencies('app', ['page', 'feature', 'entity', 'shared']),
            allowPublicDependencies('page', ['feature', 'entity', 'shared']),
            allowPublicDependencies('feature', ['entity', 'shared']),
            allowPublicDependencies('entity', ['entity', 'shared']),
            allowPublicDependencies('shared', ['shared']),
            {
              disallow: { to: { file: { categories: 'test' } } },
              message: 'Application code must not import test files.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
