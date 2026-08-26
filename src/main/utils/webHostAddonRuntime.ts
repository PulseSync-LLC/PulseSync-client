import { parse as parseJavaScript } from 'acorn'

export const MAX_WEB_HOST_ADDON_CODE_LENGTH = 10_000_000
export const SUPPORTED_WEB_HOST_API_VERSION = 1

export type WebHostAddonValidationCategory =
    'empty-code' | 'code-too-large' | 'invalid-javascript' | 'invalid-webhost-bundle' | 'unsupported-api-version' | 'blocked-isolated-capability'

export type WebHostAddonValidationResult =
    { ok: true; code: string; apiVersion: number } | { ok: false; category: WebHostAddonValidationCategory; reason: string }

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

function readStaticString(node: unknown): string | null {
    if (!isJavaScriptNode(node)) return null
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value
    if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0 && Array.isArray(node.quasis)) {
        return node.quasis
            .map(quasi => {
                if (!isJavaScriptNode(quasi) || !quasi.value || typeof quasi.value !== 'object') return ''
                const cooked = (quasi.value as { cooked?: unknown }).cooked
                return typeof cooked === 'string' ? cooked : ''
            })
            .join('')
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        const left = readStaticString(node.left)
        const right = readStaticString(node.right)
        return left !== null && right !== null ? left + right : null
    }
    return null
}

function isExecutableMarkup(value: string): boolean {
    return (
        /<\s*script\b/i.test(value) ||
        /\son[a-z0-9_-]+\s*=/i.test(value) ||
        /\b(?:href|src|action|formaction|xlink:href)\s*=\s*['"]?\s*javascript\s*:/i.test(value) ||
        /<\s*iframe\b[^>]*\bsrcdoc\s*=/i.test(value)
    )
}

function isExecutableAttribute(name: string, value: string): boolean {
    const normalizedName = name.toLowerCase()
    if (normalizedName.startsWith('on') || normalizedName === 'srcdoc') return true
    return ['href', 'src', 'action', 'formaction', 'xlink:href'].includes(normalizedName) && /^\s*javascript\s*:/i.test(value)
}

function findBlockedIsolatedCapability(root: JavaScriptNode): string | null {
    let reason: string | null = null

    visitJavaScriptNodes(root, node => {
        if (reason) return

        if (node.type === 'CallExpression' && isJavaScriptNode(node.callee) && node.callee.type === 'MemberExpression') {
            const methodName = readStaticPropertyName(node.callee)
            const args = Array.isArray(node.arguments) ? node.arguments : []
            const tagName = methodName === 'createElementNS' ? readStaticString(args[1]) : readStaticString(args[0])

            if ((methodName === 'createElement' || methodName === 'createElementNS') && tagName?.toLowerCase() === 'script') {
                reason = 'executable script element creation is not allowed'
                return
            }

            if (methodName === 'setAttribute' || methodName === 'setAttributeNS') {
                const attributeOffset = methodName === 'setAttributeNS' ? 1 : 0
                const attributeName = readStaticString(args[attributeOffset])
                const attributeValue = readStaticString(args[attributeOffset + 1])
                if (attributeName !== null && attributeValue !== null && isExecutableAttribute(attributeName, attributeValue)) {
                    reason = `executable DOM attribute ${attributeName} is not allowed`
                    return
                }
            }

            const markupArgument = methodName === 'insertAdjacentHTML' ? args[1] : args[0]
            if (['insertAdjacentHTML', 'createContextualFragment', 'write', 'writeln'].includes(methodName ?? '')) {
                const markup = readStaticString(markupArgument)
                if (markup !== null && isExecutableMarkup(markup)) {
                    reason = `executable markup through ${methodName} is not allowed`
                    return
                }
            }
        }

        if (node.type !== 'AssignmentExpression' || !isJavaScriptNode(node.left) || node.left.type !== 'MemberExpression') return
        const propertyName = readStaticPropertyName(node.left)
        const value = readStaticString(node.right)
        if (!propertyName || value === null) return

        if (['innerHTML', 'outerHTML'].includes(propertyName) && isExecutableMarkup(value)) {
            reason = `executable markup through ${propertyName} is not allowed`
            return
        }
        if (isExecutableAttribute(propertyName, value)) reason = `executable DOM property ${propertyName} is not allowed`
    })

    return reason
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

function readWebHostApiVersion(root: JavaScriptNode): number | null {
    let found: number | null = null

    visitJavaScriptNodes(root, node => {
        if (found !== null || node.type !== 'CallExpression' || !isJavaScriptNode(node.callee) || node.callee.type !== 'MemberExpression') return
        if (readIdentifierName(node.callee.object) !== 'Object' || readStaticPropertyName(node.callee) !== 'freeze') return

        const definition = Array.isArray(node.arguments) ? node.arguments[0] : null
        if (!isJavaScriptNode(definition) || definition.type !== 'ObjectExpression' || !Array.isArray(definition.properties)) return

        let hasId = false
        let apiVersion: number | null = null

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
                apiVersion = property.value.value
            }
        }

        if (hasId && apiVersion !== null) found = apiVersion
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
    return validateWebHostAddonRuntime(content).ok
}

export function validateWebHostAddonRuntime(content: string): WebHostAddonValidationResult {
    if (content.length > MAX_WEB_HOST_ADDON_CODE_LENGTH) {
        return {
            ok: false,
            category: 'code-too-large',
            reason: `bundle exceeds ${MAX_WEB_HOST_ADDON_CODE_LENGTH} characters`,
        }
    }
    if (!content.trim()) return { ok: false, category: 'empty-code', reason: 'bundle is empty' }

    try {
        const program = parseJavaScript(content, {
            allowHashBang: true,
            ecmaVersion: 'latest',
            sourceType: 'script',
        }) as unknown as JavaScriptNode

        if (!hasWebHostQueueRegistration(program)) {
            return { ok: false, category: 'invalid-webhost-bundle', reason: 'WebHost addon queue registration was not found' }
        }

        const apiVersion = readWebHostApiVersion(program)
        if (apiVersion === null) {
            return { ok: false, category: 'invalid-webhost-bundle', reason: 'frozen WebHost addon definition was not found' }
        }
        if (apiVersion !== SUPPORTED_WEB_HOST_API_VERSION) {
            return {
                ok: false,
                category: 'unsupported-api-version',
                reason: `unsupported WebHost addon API version ${apiVersion}`,
            }
        }

        const blockedCapability = findBlockedIsolatedCapability(program)
        if (blockedCapability) return { ok: false, category: 'blocked-isolated-capability', reason: blockedCapability }

        return { ok: true, code: content, apiVersion }
    } catch (error) {
        return {
            ok: false,
            category: 'invalid-javascript',
            reason: error instanceof Error ? `bundle is not valid JavaScript: ${error.message}` : 'bundle is not valid JavaScript',
        }
    }
}
