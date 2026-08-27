import propertyGroups from 'stylelint-config-recess-order/groups'

export default {
    extends: ['stylelint-config-standard-scss'],
    plugins: ['stylelint-order'],
    ignoreFiles: ['**/node_modules/**', '**/.vite/**', '**/out/**', '**/dist/**', '**/release/**', '**/coverage/**'],
    rules: {
        'order/properties-order': [
            propertyGroups.map(group => ({
                ...group,
                emptyLineBefore: 'always',
                noEmptyLineBetween: true,
            })),
            {
                unspecified: 'bottom',
            },
        ],
        'declaration-empty-line-before': null,
        'selector-class-pattern': [
            '^[a-zA-Z_][a-zA-Z0-9_-]*$',
            {
                message: 'Expected a conventional camelCase or kebab-case class selector',
                severity: 'warning',
            },
        ],
        'no-descending-specificity': null,
        'no-empty-source': null,
        'color-function-notation': null,
        'alpha-value-notation': null,
        'font-family-no-missing-generic-family-keyword': null,
        'number-max-precision': null,
        'keyframes-name-pattern': null,
        'selector-id-pattern': null,
        'declaration-property-value-keyword-no-deprecated': null,
        'selector-pseudo-class-no-unknown': [
            true,
            {
                ignorePseudoClasses: ['global'],
            },
        ],
        'scss/dollar-variable-pattern': null,
        'scss/at-extend-no-missing-placeholder': null,
        'scss/comment-no-empty': null,
        'custom-property-pattern': null,
    },
}
