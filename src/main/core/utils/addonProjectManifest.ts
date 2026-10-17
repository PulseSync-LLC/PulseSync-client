import { parse } from 'acorn'
import { simple as walkSimple } from 'acorn-walk'

import type { Expression, Node, ObjectExpression, Property } from 'acorn'

const editableFields = [
    'name',
    'description',
    'version',
    'author',
    'image',
    'banner',
    'libraryLogo',
    'tags',
    'dependencies',
    'allowedUrls',
    'supportedVersions',
]

function propertyName(property: Property): string {
    if (property.computed || property.method || property.kind !== 'init') throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
    if (property.key.type === 'Identifier') return property.key.name
    if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value
    throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
}

function literalValue(node: Expression): unknown {
    if (node.type === 'Literal' && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value))) return node.value
    if (node.type === 'ArrayExpression') {
        return node.elements.map(element => {
            if (!element || element.type === 'SpreadElement') throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
            return literalValue(element)
        })
    }
    if (node.type === 'ObjectExpression') {
        return Object.fromEntries(
            node.properties.map(property => {
                if (property.type !== 'Property') throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
                return [propertyName(property), literalValue(property.value as Expression)]
            }),
        )
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
    if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator)) {
        const value = literalValue(node.argument)
        if (typeof value === 'number') return node.operator === '-' ? -value : value
    }
    throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
}

function configObject(source: string): ObjectExpression {
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
    const exported = program.body.find(statement => statement.type === 'ExportDefaultDeclaration')
    if (exported?.type !== 'ExportDefaultDeclaration') throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
    if (exported.declaration.type === 'ObjectExpression') return exported.declaration
    if (exported.declaration.type === 'Identifier') {
        const name = exported.declaration.name
        for (const statement of program.body) {
            if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue
            const declaration = statement.declarations.find(entry => entry.id.type === 'Identifier' && entry.id.name === name)
            if (declaration?.init?.type === 'ObjectExpression') return declaration.init
        }
    }
    throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
}

export function readAddonProjectConfig(source: string): Record<string, unknown> {
    return literalValue(configObject(source)) as Record<string, unknown>
}

type StringQuote = "'" | '"'

function preferredQuote(node: Node, source: string, fallback: StringQuote): StringQuote {
    let quote: StringQuote | undefined
    walkSimple(node, {
        Literal(literal) {
            if (quote || typeof literal.value !== 'string') return
            const delimiter = source[literal.start]
            if (delimiter === "'" || delimiter === '"') quote = delimiter
        },
    })
    return quote ?? fallback
}

function serializeConfigValue(value: unknown, quote: StringQuote): string {
    const json = JSON.stringify(value, null, 4)
    if (quote === '"') return json
    return json.replace(/"(?:\\.|[^"\\])*"/g, token => "'" + token.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'")
}

export function updateAddonProjectConfig(source: string, manifest: Record<string, unknown>): string {
    const object = configObject(source)
    const previous = literalValue(object) as Record<string, unknown>
    const defaultQuote = preferredQuote(object, source, "'")
    const edits: { start: number; end: number; text: string }[] = []
    const additions: string[] = []
    for (const field of editableFields) {
        if (!Object.hasOwn(manifest, field) || JSON.stringify(previous[field]) === JSON.stringify(manifest[field])) continue
        const property = object.properties.findLast(entry => entry.type === 'Property' && propertyName(entry) === field) as Property | undefined
        const value = serializeConfigValue(manifest[field], property ? preferredQuote(property.value, source, defaultQuote) : defaultQuote)
        if (property) {
            const indentation = source.slice(source.lastIndexOf('\n', property.start) + 1, property.start).match(/^\s*/)?.[0] ?? ''
            edits.push({ start: property.value.start, end: property.value.end, text: value.replace(/\n/g, `\n${indentation}`) })
        } else {
            additions.push(`\n    ${field}: ${value.replace(/\n/g, '\n    ')},`)
        }
    }
    if (additions.length) edits.push({ start: object.start + 1, end: object.start + 1, text: additions.join('') })
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
    return source
}
