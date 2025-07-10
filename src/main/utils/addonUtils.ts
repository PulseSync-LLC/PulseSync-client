import { app } from 'electron'
import path from 'path'
import * as fs from 'original-fs'
import { getFolderSize, formatSizeUnits } from './appUtils'
import logger from '../modules/logger'
import Addon from '../../renderer/api/interfaces/addon.interface'
import { getState } from '../modules/state'
import * as acorn from 'acorn'
import { simple as walkSimple } from 'acorn-walk'

const State = getState()
const defaultAddon: Partial<Addon> = {
    name: 'Default',
    image: 'url',
    author: 'Your Name',
    description: 'Default theme.',
    version: '1.0.0',
    type: 'theme',
    css: 'style.css',
    script: 'script.js',
    dependencies: [],
    allowedUrls: [],
}

const defaultCssContent = `{}`
const defaultScriptContent = ``

export function createDefaultAddonIfNotExists(themesFolderPath: string) {
    const defaultAddonPath = path.join(themesFolderPath, defaultAddon.name!)
    const metadataPath = path.join(defaultAddonPath, 'metadata.json')

    try {
        if (fs.existsSync(defaultAddonPath)) {
            if (fs.existsSync(metadataPath)) {
                let metadata
                try {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
                } catch (err) {
                    logger.main.error(`Addons: error parsing metadata.json in ${defaultAddonPath}:`, err)
                    return
                }
                if (!metadata.hasOwnProperty('type')) {
                    metadata.type = defaultAddon.type
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4), 'utf-8')
                    logger.main.info(`Addons: metadata.json updated in ${defaultAddonPath}.`)
                }
            }
            return
        }

        fs.mkdirSync(defaultAddonPath, { recursive: true })
        fs.mkdirSync(path.join(defaultAddonPath, 'Assets'), { recursive: true })

        const cssPath = path.join(defaultAddonPath, defaultAddon.css!)
        const scriptPath = path.join(defaultAddonPath, defaultAddon.script!)

        fs.writeFileSync(metadataPath, JSON.stringify(defaultAddon, null, 4), 'utf-8')
        fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')
        fs.writeFileSync(scriptPath, defaultScriptContent, 'utf-8')

        logger.main.info(`Addons: default theme created at ${defaultAddonPath}.`)
    } catch (err) {
        logger.main.error(`Addons: error creating default theme at ${defaultAddonPath}:`, err)
    }
}

export async function loadAddons(): Promise<Addon[]> {
    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')

    createDefaultAddonIfNotExists(addonsFolderPath)

    const ignoredFolders = ['.DS_Store', '.git']

    const allFolders = await fs.promises.readdir(addonsFolderPath)
    const folders = allFolders.filter(folder => !ignoredFolders.includes(folder))

    const availableAddons: Addon[] = []

    for (const folder of folders) {
        const addonFolderPath = path.join(addonsFolderPath, folder)
        const metadataFilePath = path.join(addonFolderPath, 'metadata.json')

        if (fs.existsSync(metadataFilePath)) {
            try {
                const data = await fs.promises.readFile(metadataFilePath, 'utf-8')
                const stats = await fs.promises.stat(metadataFilePath)
                const folderSize = await getFolderSize(addonFolderPath)
                const modificationDate = new Date(stats.mtime)
                const now = new Date()

                const diffTime = Math.abs(now.getTime() - modificationDate.getTime())
                let diffString: string
                const diffSeconds = Math.floor(diffTime / 1000)
                const diffMinutes = Math.floor(diffSeconds / 60)
                const diffHours = Math.floor(diffMinutes / 60)
                const diffDays = Math.floor(diffHours / 24)

                if (diffSeconds < 60) {
                    diffString = `${diffSeconds} sec ago`
                } else if (diffMinutes < 60) {
                    diffString = `${diffMinutes} min ago`
                } else if (diffHours < 24) {
                    diffString = `${diffHours} hours ago`
                } else {
                    diffString = `${diffDays} days ago`
                }

                const versionRegex = /^\d+(\.\d+){0,2}$/
                const metadata = JSON.parse(data) as Addon
                const versionMatch = metadata.version.match(versionRegex)
                if (!versionMatch) {
                    logger.main.log(`Addons: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`)
                    metadata.version = '1.0.0'
                    await fs.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 4), 'utf-8').catch(err => {
                        logger.main.error(`Addons: error writing metadata.json in theme ${folder}:`, err)
                    })
                } else {
                    metadata.version = versionMatch[0]
                }

                metadata.lastModified = diffString
                metadata.path = addonFolderPath
                metadata.size = formatSizeUnits(folderSize)
                metadata.directoryName = folder

                availableAddons.push(metadata)
            } catch (err) {
                logger.main.error(`Addons: error reading or parsing metadata.json in theme ${folder}:`, err)
            }
        } else {
            logger.main.error(`Addons: metadata.json not found in theme ${folder}`)
        }
    }

    let selectedTheme = State.get('addons.theme') ?? 'Default'
    let selectedScripts = State.get('addons.scripts') ?? []
    logger.main.log(selectedScripts)

    const themeAddonExists = availableAddons.some(addon => addon.type === 'theme' && addon.directoryName === selectedTheme)
    if (!themeAddonExists) {
        selectedTheme = 'Default'
        State.set('addons.theme', selectedTheme)
    }
    selectedScripts = availableAddons
        .filter(addon => addon.type === 'script' && selectedScripts.includes(addon.directoryName!))
        .map(addon => addon.directoryName!)
    State.set('addons.scripts', selectedScripts)

    availableAddons.forEach(addon => {
        if (addon.type === 'theme' && addon.directoryName === selectedTheme) {
            addon.enabled = true
        } else if (addon.type === 'script' && selectedScripts.includes(addon.directoryName!)) {
            addon.enabled = true
        }
    })

    return availableAddons
}
export function sanitizeScript(js: string): string {
    let found = false
    try {
        const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script' }) as acorn.Node
        const oauthVars = new Set<string>()

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
                return node.quasis.map((q: any ) => q.value.cooked).join('')
            }
            return undefined
        }

        walkSimple(ast, {
            VariableDeclarator(node: any) {
                const name = node.id.type === 'Identifier' ? node.id.name : undefined
                if (!name) return
                const val = node.init ? evalStaticString(node.init) : undefined
                if (val === 'oauth') {
                    oauthVars.add(name)
                }
            },
        })

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
            }
            return path
        }

        function inspectCall(node: any): void {
            const callee = node.callee
            if (callee.type !== 'MemberExpression') return
            const path = getMemberPath(callee)
            const len = path.length
            const method = path[len - 1]
            const target = path[len - 2]
            if (target !== 'localStorage') return
            if (!['getItem', 'setItem', 'removeItem', 'clear'].includes(method)) return
            if (method === 'clear') {
                found = true
                return
            }
            const arg = node.arguments[0]
            if (!arg) return
            const staticVal = evalStaticString(arg)
            const isLiteral = staticVal === 'oauth'
            const isVar = arg.type === 'Identifier' && oauthVars.has(arg.name)
            const isDirectId = arg.type === 'Identifier' && arg.name === 'oauth'
            if (isLiteral || isVar || isDirectId) {
                found = true
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
            CallExpression(node: any) {
                inspectCall(node)
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
        logger.http.warn('SUS script detected.')
        return ''
    }
    return js
}
