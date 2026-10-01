import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseSync } from '@babel/core'

function visit(node, callback) {
    if (!node || typeof node.type !== 'string') return
    callback(node)
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(child => visit(child, callback))
        else if (value && typeof value === 'object') visit(value, callback)
    }
}

function propertyName(node) {
    return node.key?.name ?? node.key?.value
}

function fallback(reason) {
    return { desktop: true, desktop_core: false, renderer: true, details: [reason] }
}

export function classifyCommonChanges(changedFiles, root = process.cwd()) {
    const result = { desktop: false, desktop_core: false, renderer: false, details: [] }
    if (!changedFiles.length) return result

    try {
        const read = file => fs.readFileSync(path.resolve(root, file), 'utf8')
        const cache = new Map()
        function parse(file) {
            if (!cache.has(file)) {
                cache.set(
                    file,
                    parseSync(read(file), {
                        filename: file,
                        babelrc: false,
                        configFile: false,
                        browserslistConfigFile: false,
                        parserOpts: { plugins: ['typescript', ...(/\.[jt]sx$/u.test(file) ? ['jsx'] : [])] },
                    }),
                )
            }
            return cache.get(file)
        }

        const packageJson = JSON.parse(read('package.json'))
        const packages = new Set(Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies, ...packageJson.optionalDependencies }))
        const aliases = new Map()
        for (const [name, targets] of Object.entries(JSON.parse(read('tsconfig.json')).compilerOptions.paths)) {
            if (!name.endsWith('/*') || targets.length !== 1 || !targets[0].endsWith('/*')) throw new Error(`Unsupported alias: ${name}`)
            aliases.set(name.slice(0, -2), path.resolve(root, targets[0].slice(0, -2)))
        }

        for (const config of ['vite.main.config.ts', 'vite.preload.config.ts', 'vite.renderer.config.ts', 'vite.worker.config.ts']) {
            visit(parse(config), node => {
                if (node.type !== 'ObjectProperty' || propertyName(node) !== 'alias') return
                if (node.value.type !== 'ObjectExpression') throw new Error(`Unsupported aliases in ${config}`)
                for (const alias of node.value.properties) {
                    const name = propertyName(alias)
                    const value = alias.value
                    if (value?.type === 'StringLiteral' && packages.has(value.value)) continue
                    if (
                        value?.type !== 'CallExpression' ||
                        value.callee.object?.name !== 'path' ||
                        value.callee.property?.name !== 'resolve' ||
                        value.arguments.length !== 2 ||
                        value.arguments[0].name !== '__dirname' ||
                        value.arguments[1].type !== 'StringLiteral'
                    ) {
                        throw new Error(`Unsupported alias ${name} in ${config}`)
                    }
                    const target = path.resolve(root, value.arguments[1].value)
                    if (aliases.has(name) && aliases.get(name) !== target) throw new Error(`Alias mismatch: ${name}`)
                    aliases.set(name, target)
                }
            })
        }

        const entries = { desktop: [], desktop_core: ['scripts/build.ts'], renderer: ['scripts/renderer/remote-renderer.ts'] }
        const coreEntries = new Set(['src/main/core/desktopCore.ts', 'src/preload/mainWindowPreload.ts'])
        const htmlEntries = new Map()
        let remoteEntry
        visit(parse('vite.renderer.config.ts'), node => {
            if (node.type !== 'VariableDeclarator') return
            if (node.id.name === 'rendererHtmlEntries' && node.init?.type === 'ObjectExpression') {
                for (const item of node.init.properties) {
                    if (item.value?.type !== 'StringLiteral') throw new Error('Unsupported renderer HTML entry')
                    htmlEntries.set(propertyName(item), item.value.value)
                }
            }
            if (node.id.name === 'name' && node.init?.type === 'ConditionalExpression' && node.init.test.name === 'isRemoteRendererBuild') {
                remoteEntry = node.init.consequent.value
            }
        })
        function addHtmlEntry(name, owner) {
            const html = htmlEntries.get(name)
            if (!html) throw new Error(`Unknown renderer entry: ${name}`)
            const source = read(html)
            const scripts = [...source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
            if (!scripts.length || scripts.length !== [...source.matchAll(/<script\b/giu)].length)
                throw new Error(`Unsupported script entry in ${html}`)
            for (const [, script] of scripts) {
                if (/^[a-z]+:/iu.test(script)) throw new Error(`External script in ${html}`)
                entries[owner].push(script.startsWith('/') ? script.slice(1) : path.posix.join(path.posix.dirname(html), script))
            }
        }
        addHtmlEntry(remoteEntry, 'renderer')
        visit(parse('forge.config.ts'), node => {
            if (node.type !== 'ObjectProperty') return
            if (propertyName(node) === 'build') {
                if (node.value.type !== 'ArrayExpression') throw new Error('Unsupported Forge build entries')
                for (const item of node.value.elements) {
                    const entry = item?.properties?.find(field => propertyName(field) === 'entry')?.value
                    const config = item?.properties?.find(field => propertyName(field) === 'config')?.value
                    if (
                        entry?.type !== 'StringLiteral' ||
                        config?.type !== 'StringLiteral' ||
                        !['vite.main.config.ts', 'vite.preload.config.ts', 'vite.worker.config.ts'].includes(config.value)
                    ) {
                        throw new Error('Unsupported Forge build entry')
                    }
                    entries[coreEntries.has(entry.value) ? 'desktop_core' : 'desktop'].push(entry.value)
                }
            }
            if (propertyName(node) === 'renderer') {
                if (node.value.type !== 'ArrayExpression') throw new Error('Unsupported Forge renderer entries')
                for (const entry of node.value.elements) {
                    const name = entry?.properties?.find(item => propertyName(item) === 'name')?.value?.value
                    addHtmlEntry(name, 'desktop')
                }
            }
        })
        if (!entries.desktop.length || ![...coreEntries].every(entry => entries.desktop_core.includes(entry)))
            throw new Error('Incomplete Forge entries')

        function resolveImport(specifier, importer) {
            const alias = [...aliases.keys()].find(name => specifier === name || specifier.startsWith(`${name}/`))
            let target
            if (alias) target = path.resolve(aliases.get(alias), specifier.slice(alias.length).replace(/^\//u, ''))
            else if (specifier.startsWith('.')) target = path.resolve(root, path.dirname(importer), specifier)
            else if (specifier.startsWith('/')) target = path.resolve(root, `.${specifier}`)
            else {
                const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
                if (isBuiltin(specifier) || specifier === 'original-fs' || packages.has(packageName)) return null
                throw new Error(`Unknown import ${specifier} in ${importer}`)
            }
            target = target.split('?')[0]
            const candidates = [
                target,
                target.replace(/\.js$/u, '.ts'),
                ...['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx'].map(ext => target + ext),
            ]
            const resolved = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile())
            if (!resolved) throw new Error(`Unresolved import ${specifier} in ${importer}`)
            const relative = path.relative(root, resolved).replaceAll('\\', '/')
            if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Import outside project in ${importer}`)
            return relative
        }

        const dependencies = new Map()
        function imports(file) {
            if (dependencies.has(file)) return dependencies.get(file)
            const found = []
            dependencies.set(file, found)
            if (!/\.[cm]?[jt]sx?$/u.test(file)) return found
            function add(source) {
                if (source?.type !== 'StringLiteral') throw new Error(`Dynamic import in ${file}`)
                const resolved = resolveImport(source.value, file)
                if (resolved) found.push(resolved)
            }
            visit(parse(file), node => {
                if (
                    node.type === 'ImportDeclaration' &&
                    ['node:module', 'module'].includes(node.source.value) &&
                    node.specifiers.some(specifier => specifier.imported?.name === 'createRequire' || specifier.imported?.value === 'createRequire')
                ) {
                    throw new Error(`Unsupported createRequire in ${file}`)
                }
                if (
                    node.type === 'CallExpression' &&
                    ((node.callee.object?.name === 'module' && (node.callee.property?.name ?? node.callee.property?.value) === 'require') ||
                        (node.callee.object?.name === 'require' && (node.callee.property?.name ?? node.callee.property?.value) === 'resolve') ||
                        (node.callee.property?.name ?? node.callee.property?.value) === 'createRequire')
                ) {
                    throw new Error(`Unsupported module discovery in ${file}`)
                }
                if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) add(node.source)
                if (node.type === 'ImportExpression') add(node.source)
                if (node.type === 'TSImportType') add(node.argument)
                if (node.type === 'TSExternalModuleReference') add(node.expression)
                if (node.type === 'CallExpression' && ['require', '__non_vite_require__'].includes(node.callee.name)) {
                    const argument = node.arguments[0]
                    const compiledComponent =
                        node.callee.name === '__non_vite_require__' &&
                        node.arguments.length === 1 &&
                        argument?.type === 'Identifier' &&
                        ((file === 'src/main/host/bootstrap.ts' && argument.name === 'coreEntry') ||
                            (file === 'src/main/core/nativeModules/pulsesyncNative.ts' && argument.name === 'modulePath'))
                    if (!compiledComponent) add(argument)
                }
                if (node.type === 'CallExpression' && node.callee.object?.type === 'MetaProperty')
                    throw new Error(`Dynamic module discovery in ${file}`)
            })
            return found
        }

        const closures = Object.fromEntries(
            Object.entries(entries).map(([owner, roots]) => {
                const files = new Set()
                function collect(file) {
                    if (files.has(file)) return
                    files.add(file)
                    imports(file).forEach(collect)
                }
                roots.forEach(collect)
                return [owner, files]
            }),
        )
        for (const file of changedFiles) {
            if (!/\.(?:[cm]?[jt]s|[jt]sx|json)$/u.test(file)) throw new Error(`Unsupported common source: ${file}`)
            if (!file.startsWith('src/common/') || !fs.existsSync(path.resolve(root, file))) throw new Error(`Missing common source: ${file}`)
            const owners = Object.keys(closures).filter(owner => closures[owner].has(file))
            if (!owners.length) throw new Error(`Unknown common owner: ${file}`)
            for (const owner of owners) result[owner] = true
            result.details.push(`${file}: ${owners.join(', ')}`)
        }
        return result
    } catch (error) {
        return fallback(error.message)
    }
}

export function classifyCommonPush(changedFiles, before, root = process.cwd()) {
    if (!changedFiles.length) return classifyCommonChanges([], root)
    try {
        if (!/^[a-f0-9]{40}$/iu.test(before || '') || /^0+$/u.test(before)) throw new Error('Missing previous commit for common changes')
        const deleted = execFileSync('git', ['diff', '--name-only', '--diff-filter=D', '--no-renames', '-z', before, 'HEAD', '--', 'src/common'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        if (deleted) throw new Error('Deleted or renamed common source')
        return classifyCommonChanges(changedFiles, root)
    } catch (error) {
        return fallback(error.message)
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const result = classifyCommonPush(JSON.parse(process.env.COMMON_FILES || '[]'), process.env.BEFORE_SHA)
    for (const detail of result.details) console.log(detail)
    for (const name of ['desktop', 'desktop_core', 'renderer']) {
        console.log(`${name}=${result[name]}`)
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`)
    }
}
