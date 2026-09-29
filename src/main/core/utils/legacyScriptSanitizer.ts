import * as acorn from 'acorn'
import { simple as walkSimple } from 'acorn-walk'

export function sanitizeLegacyScript(js: string): string {
    let found = false
    try {
        const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script' }) as acorn.Node
        const oauthVars = new Set<string>()
        const evalAliases = new Set<string>()
        const fnCtorAliases = new Set<string>()

        function evalStaticString(node: any): string | undefined {
            if (node.type === 'Literal' && typeof node.value === 'string') {
                return node.value
            }
            if (node.type === 'BinaryExpression' && node.operator === '+') {
                const left = evalStaticString(node.left)
                const right = evalStaticString(node.right)
                if (typeof left === 'string' && typeof right === 'string') {
                    return left + right
                }
            }
            if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
                return node.quasis.map((q: any) => q.value.cooked).join('')
            }
            return undefined
        }

        function getMemberPath(node: any): string[] {
            const path: string[] = []
            let current: any = node
            while (current && current.type === 'MemberExpression') {
                if (current.property.type === 'Identifier') {
                    path.unshift(current.property.name)
                } else if (current.property.type === 'Literal') {
                    path.unshift(String(current.property.value))
                }
                current = current.object
            }
            if (current && current.type === 'Identifier') {
                path.unshift(current.name)
            } else if (current && current.type === 'ThisExpression') {
                path.unshift('this')
            }
            return path
        }

        function resolveCallee(node: any): any {
            if (!node) return node
            if (node.type === 'ChainExpression') return node.expression
            if (node.type === 'SequenceExpression') {
                const arr = node.expressions
                return arr && arr.length ? arr[arr.length - 1] : node
            }
            return node
        }

        function isIdentifierNamed(node: any, name: string): boolean {
            return node && node.type === 'Identifier' && node.name === name
        }

        function isEvalRef(node: any): boolean {
            const n = resolveCallee(node)
            if (isIdentifierNamed(n, 'eval')) return true
            if (n && n.type === 'MemberExpression') {
                const p = getMemberPath(n)
                return p[p.length - 1] === 'eval'
            }
            return false
        }

        function isFunctionCtorRef(node: any): boolean {
            const n = resolveCallee(node)
            if (isIdentifierNamed(n, 'Function')) return true
            if (n && n.type === 'MemberExpression') {
                const p = getMemberPath(n)
                if (p[p.length - 1] === 'Function') return true
                if (p.length >= 2 && p[p.length - 1] === 'constructor' && p[p.length - 2] === 'constructor') return true
            }
            return false
        }

        function isStringyArg(node: any): boolean {
            return typeof evalStaticString(node) === 'string'
        }

        function isScriptElementCreation(node: any): boolean {
            if (!node || node.type !== 'CallExpression') return false

            const callee = resolveCallee(node.callee)
            if (!callee || callee.type !== 'MemberExpression') return false

            const path = getMemberPath(callee)
            const tagName = node.arguments[0] ? evalStaticString(node.arguments[0]) : undefined
            return path[path.length - 1] === 'createElement' && tagName?.toLowerCase() === 'script'
        }

        function inspectCall(node: any): void {
            const callee = resolveCallee(node.callee)

            if (isScriptElementCreation(node)) {
                found = true
                return
            }

            if (isIdentifierNamed(callee, 'eval') || (callee && callee.type === 'MemberExpression' && getMemberPath(callee).includes('eval'))) {
                found = true
                return
            }

            if (callee && callee.type === 'MemberExpression') {
                const obj = resolveCallee(callee.object)
                if (isEvalRef(obj)) {
                    found = true
                    return
                }
            }

            if (isFunctionCtorRef(callee)) {
                found = true
                return
            }

            if (callee && callee.type === 'MemberExpression') {
                const p = getMemberPath(callee)
                if (p.length >= 2 && p[p.length - 1] === 'constructor' && p[p.length - 2] === 'constructor') {
                    if (node.arguments.some((a: any) => isStringyArg(a))) {
                        found = true
                        return
                    }
                }
            }

            if (isIdentifierNamed(callee, 'setTimeout') || isIdentifierNamed(callee, 'setInterval')) {
                const first = node.arguments[0]
                if (first && isStringyArg(first)) {
                    found = true
                    return
                }
            }
            if (callee && callee.type === 'MemberExpression') {
                const p = getMemberPath(callee)
                if (p[p.length - 1] === 'setTimeout' || p[p.length - 1] === 'setInterval') {
                    const first = node.arguments[0]
                    if (first && isStringyArg(first)) {
                        found = true
                        return
                    }
                }
            }

            if (callee && callee.type === 'Identifier') {
                if (evalAliases.has(callee.name) || fnCtorAliases.has(callee.name)) {
                    found = true
                    return
                }
            }
        }

        function inspectNew(node: any): void {
            const callee = resolveCallee(node.callee)
            if (isFunctionCtorRef(callee)) {
                found = true
                return
            }
            if (callee && callee.type === 'Identifier' && fnCtorAliases.has(callee.name)) {
                found = true
                return
            }
        }

        function inspectMember(node: any): void {
            const path = getMemberPath(node)
            const len = path.length
            if (len >= 2 && path[len - 2] === 'localStorage' && path[len - 1] === 'oauth') {
                found = true
            }
        }

        walkSimple(ast, {
            VariableDeclarator(node: any) {
                const name = node.id && node.id.type === 'Identifier' ? node.id.name : undefined
                if (!name) return
                const init = node.init
                const val = init ? evalStaticString(init) : undefined
                if (val === 'oauth') {
                    oauthVars.add(name)
                }
                if (init && isEvalRef(init)) {
                    evalAliases.add(name)
                }
                if (init && isFunctionCtorRef(init)) {
                    fnCtorAliases.add(name)
                }
            },
            CallExpression(node: any) {
                inspectCall(node)
                if (found) return
                const callee = resolveCallee(node.callee)
                if (callee && callee.type === 'Identifier') {
                    if (
                        oauthVars.has(callee.name) &&
                        node.arguments.length > 0 &&
                        isStringyArg(node.arguments[0]) &&
                        evalStaticString(node.arguments[0]) === 'oauth'
                    ) {
                        found = true
                    }
                }
            },
            NewExpression(node: any) {
                inspectNew(node)
            },
            ChainExpression(node: any) {
                const expr = (node as any).expression
                if (expr.type === 'CallExpression') {
                    inspectCall(expr)
                } else if (expr.type === 'MemberExpression') {
                    inspectMember(expr)
                }
            },
            MemberExpression(node: any) {
                inspectMember(node)
            },
        })
    } catch {}

    if (found) {
        console.warn('[PulseSync Addons] Blocked legacy script: legacy sanitizer policy')
        return ''
    }
    return js
}

export const sanitizeScript = sanitizeLegacyScript
