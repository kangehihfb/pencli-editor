module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.node.json'],
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    'import/resolver': {
      typescript: true,
    },
  },
  extends: [
    'airbnb',
    'airbnb-typescript',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:unicorn/recommended',
    'plugin:security/recommended-legacy',
    'plugin:prettier/recommended',
  ],
  rules: {
    complexity: ['error', 3],
    'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 2],
    'no-console': 'error',
    'import/no-mutable-exports': 'error',
    'unicorn/no-abusive-eslint-disable': 'error',
    'unicorn/no-useless-undefined': 'off',
    'unicorn/prevent-abbreviations': 'error',
    'unicorn/prefer-at': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'error',
    'react/react-in-jsx-scope': 'off',
    'react/no-unknown-property': 'off',
  },
  overrides: [
    {
      files: ['vite.config.ts', 'scripts/**/*.{js,mjs,ts}'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
};
