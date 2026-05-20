import { builtinRules } from 'eslint/use-at-your-own-risk';

function aliasCoreRule(ruleName) {
  const baseRule = builtinRules.get(ruleName);
  if (!baseRule) {
    throw new Error(`Missing ESLint core rule: ${ruleName}`);
  }
  return {
    meta: baseRule.meta,
    create(context) {
      return baseRule.create(context);
    }
  };
}

const cleanCodePlugin = {
  rules: {
    'max-lines-per-function-warn': aliasCoreRule('max-lines-per-function'),
    'max-lines-per-function-error': aliasCoreRule('max-lines-per-function'),
    'max-params-warn': aliasCoreRule('max-params'),
    'max-params-error': aliasCoreRule('max-params'),
    'complexity-warn': aliasCoreRule('complexity'),
    'complexity-error': aliasCoreRule('complexity')
  }
};

export default [
  {
    files: ['pforge-mcp/**/*.mjs', 'pforge-master/**/*.mjs', 'scripts/**/*.mjs'],
    ignores: ['scripts/audit/**', '**/tests/**', '**/node_modules/**', '**/ui/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    plugins: {
      'clean-code': cleanCodePlugin
    },
    rules: {
      'clean-code/max-lines-per-function-warn': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      'clean-code/max-lines-per-function-error': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'clean-code/max-params-warn': ['warn', 4],
      'clean-code/max-params-error': ['error', 6],
      'clean-code/complexity-warn': ['warn', 12],
      'clean-code/complexity-error': ['error', 20],
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 3],
      'no-magic-numbers': ['warn', {
        ignore: [-1, 0, 1, 2, 100, 1000],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        detectObjects: false,
        enforceConst: false
      }]
    }
  }
];
