import { parse as parseJavaScript } from 'acorn'

interface JavaScriptNode {
    type: string
    [key: string]: unknown
}

function isJavaScriptNode(value: unknown): value is JavaScriptNode {
    return Boolean(value && typeof value === 'object' && typeof (value as JavaScriptNode).type === 'string')
}

function visitJavaScriptNodes(root: JavaScriptNode, visitor: (node: JavaScriptNode) => void): void {
    const pending = [root]

    while (pending.length) {
        const node = pending.pop()
        if (!node) continue

        visitor(node)
        for (const value of Object.values(node)) {
            if (isJavaScriptNode(value)) {
                pending.push(value)
                continue
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    if (isJavaScriptNode(item)) pending.push(item)
                }
            }
        }
    }
}

function readIdentifierName(node: unknown): string | null {
    return isJavaScriptNode(node) && node.type === 'Identifier' && typeof node.name === 'string' ? node.name : null
}

function readStaticPropertyName(node: JavaScriptNode): string | null {
    const key = node.type === 'Property' ? node.key : node.type === 'MemberExpression' ? node.property : null
    if (!isJavaScriptNode(key)) return null

    if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
    if (key.type === 'Literal' && typeof key.value === 'string') return key.value
    return null
}

function containsWebHostQueueAccess(root: JavaScriptNode): boolean {
    let found = false

    visitJavaScriptNodes(root, node => {
        if (found || node.type !== 'MemberExpression') return

        const owner = readIdentifierName(node.object)
        if ((owner === 'window' || owner === 'globalThis') && readStaticPropertyName(node) === '__PULSESYNC_ADDON_QUEUE__') {
            found = true
        }
    })

    return found
}

function hasWebHostDefinition(root: JavaScriptNode): boolean {
    let found = false

    visitJavaScriptNodes(root, node => {
        if (found || node.type !== 'CallExpression' || !isJavaScriptNode(node.callee) || node.callee.type !== 'MemberExpression') return
        if (readIdentifierName(node.callee.object) !== 'Object' || readStaticPropertyName(node.callee) !== 'freeze') return

        const definition = Array.isArray(node.arguments) ? node.arguments[0] : null
        if (!isJavaScriptNode(definition) || definition.type !== 'ObjectExpression' || !Array.isArray(definition.properties)) return

        let hasId = false
        let hasApiVersion = false

        for (const property of definition.properties) {
            if (!isJavaScriptNode(property) || property.type !== 'Property') continue

            const propertyName = readStaticPropertyName(property)
            if (propertyName === 'id') hasId = true
            if (
                propertyName === 'apiVersion' &&
                isJavaScriptNode(property.value) &&
                property.value.type === 'Literal' &&
                typeof property.value.value === 'number' &&
                Number.isInteger(property.value.value) &&
                property.value.value > 0
            ) {
                hasApiVersion = true
            }
        }

        found = hasId && hasApiVersion
    })

    return found
}

function hasWebHostQueueRegistration(root: JavaScriptNode): boolean {
    const queueAliases = new Set<string>()

    visitJavaScriptNodes(root, node => {
        if (node.type === 'VariableDeclarator') {
            const alias = readIdentifierName(node.id)
            if (alias && isJavaScriptNode(node.init) && containsWebHostQueueAccess(node.init)) queueAliases.add(alias)
            return
        }

        if (node.type === 'AssignmentExpression') {
            const alias = readIdentifierName(node.left)
            if (alias && isJavaScriptNode(node.right) && containsWebHostQueueAccess(node.right)) queueAliases.add(alias)
        }
    })

    let found = false
    visitJavaScriptNodes(root, node => {
        if (found || node.type !== 'CallExpression' || !isJavaScriptNode(node.callee) || node.callee.type !== 'MemberExpression') return
        if (readStaticPropertyName(node.callee) !== 'push' || !isJavaScriptNode(node.callee.object)) return

        const queueAlias = readIdentifierName(node.callee.object)
        found = containsWebHostQueueAccess(node.callee.object) || Boolean(queueAlias && queueAliases.has(queueAlias))
    })

    return found
}

export function isValidWebHostAddonRuntime(content: string): boolean {
    if (!content.trim()) return false

    try {
        const program = parseJavaScript(content, {
            allowHashBang: true,
            ecmaVersion: 'latest',
            sourceType: 'script',
        }) as unknown as JavaScriptNode

        return hasWebHostQueueRegistration(program) && hasWebHostDefinition(program)
    } catch {
        return false
    }
}
