import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default [
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked.map( config => ( {
		...config,
		files: [ '**/*.ts', '**/*.tsx' ],
	} ) ),
	{
		files: [ '**/*.ts', '**/*.tsx' ],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.node,
			},
		},
		rules: {
			// Code quality
			'no-console': 'off',
			'@typescript-eslint/no-unused-vars': [ 'error', { argsIgnorePattern: '^_' } ],
			'@typescript-eslint/no-base-to-string': 'error',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/require-await': 'off',

			// Formatting
			'arrow-parens': [ 'error', 'as-needed' ],
			'array-element-newline': [ 'error', 'consistent' ],
			'array-bracket-newline': [ 'error', 'consistent' ],
			'array-bracket-spacing': [ 'error', 'always' ],
			'object-property-newline': [ 'error', { allowAllPropertiesOnSameLine: true } ],
			'object-curly-spacing': [ 'error', 'always' ],
			'object-curly-newline': [ 'error', { consistent: true } ],
			'max-len': [ 'warn', { code: 120, ignoreComments: true, ignoreStrings: true } ],
			'no-multiple-empty-lines': [ 'error', { max: 1 } ],
			'no-tabs': [ 'error', { allowIndentationTabs: true } ],
			'padded-blocks': [ 'error', 'never' ],
			'space-in-parens': [ 'error', 'always', { exceptions: [ '{}' ] } ],
			indent: [ 'error', 'tab', { SwitchCase: 1 } ],
			semi: [ 'error', 'never' ],
			yoda: [ 'error', 'always' ],
			quotes: [ 'error', 'single' ],
			'eol-last': [ 'error', 'always' ],
			'comma-dangle': [ 'error', 'always-multiline' ],
			'no-plusplus': [ 'error', { allowForLoopAfterthoughts: true } ],
		},
	},
	{
		ignores: [ 'dist/**', 'node_modules/**' ],
	},
]
