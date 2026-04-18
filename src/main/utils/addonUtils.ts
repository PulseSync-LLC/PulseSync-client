import { app } from 'electron'
import path from 'path'
import * as fs from 'original-fs'
import { getFolderSize, formatSizeUnits } from './appUtils'
import logger from '../modules/logger'
import Addon from '@entities/addon/model/addon.interface'
import { HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { getState } from '../modules/state'
import * as acorn from 'acorn'
import { simple as walkSimple } from 'acorn-walk'
import { resolveAddonCanonicalId, resolveAddonDirectoryKey, resolveAddonPublicationFingerprint, resolveAddonStableId } from './addonIdentity'

const State = getState()
const defaultAddon: Partial<Addon> = {
    id: 'default',
    name: 'Default',
    installSource: 'local',
    image: 'url',
    author: 'Your Name',
    description: 'Default theme.',
    version: '1.0.0',
    type: 'theme',
    css: 'style.css',
    script: 'script.js',
    dependencies: [],
    conflictsWith: [],
    allowedUrls: [],
    supportedVersions: [],
}

const defaultCssContent = `{}`
const defaultScriptContent = ``
let loadAddonsInFlight: Promise<Addon[]> | null = null

const normalizeRelationValues = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []

    return value
        .map(entry => String(entry || '').trim())
        .filter(Boolean)
}

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
                if (!metadata.id) {
                    metadata.id = defaultAddon.id
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4), 'utf-8')
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

async function loadAddonsInternal(): Promise<Addon[]> {
    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')

    createDefaultAddonIfNotExists(addonsFolderPath)

    const ignoredFolders = ['.DS_Store', '.git', '.idea', 'node_modules', '__MACOSX']

    const allFolders = await fs.promises.readdir(addonsFolderPath)
    const folders: string[] = []
    for (const folder of allFolders) {
        if (ignoredFolders.includes(folder)) continue
        const fullPath = path.join(addonsFolderPath, folder)
        try {
            const stat = await fs.promises.stat(fullPath)
            if (stat.isDirectory()) {
                folders.push(folder)
            }
        } catch (err) {
            logger.main.error(`Addons: error stating ${fullPath}:`, err)
        }
    }
    folders.sort((left, right) => left.localeCompare(right))
    const availableAddons: Addon[] = []
    const aliasMap = new Map<string, string>()

    const setAlias = (alias: string | undefined, target: string) => {
        const normalizedAlias = String(alias || '').trim()
        const normalizedTarget = String(target || '').trim()
        if (!normalizedAlias || !normalizedTarget) return

        aliasMap.set(normalizedAlias, normalizedTarget)
        aliasMap.set(normalizedAlias.toLowerCase(), normalizedTarget)
    }

    for (const folder of folders) {
        let currentFolder = folder
        let addonFolderPath = path.join(addonsFolderPath, currentFolder)
        let metadataFilePath = path.join(addonFolderPath, 'metadata.json')

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
                const previousAliases = [
                    folder,
                    typeof metadata.name === 'string' ? metadata.name.trim() : '',
                    typeof metadata.id === 'string' ? metadata.id.trim() : '',
                    typeof metadata.storeAddonId === 'string' ? metadata.storeAddonId.trim() : '',
                ].filter(Boolean)
                let metadataChanged = false

                const normalizedInstallSource =
                    metadata.installSource === 'store' || metadata.installSource === 'local' ? metadata.installSource : null
                const inferredLegacyStoreInstall =
                    !!metadata.storeAddonId &&
                    (currentFolder === String(metadata.storeAddonId).trim() || String(metadata.id || '').trim() === String(metadata.storeAddonId).trim())
                const resolvedInstallSource =
                    normalizedInstallSource || inferredLegacyStoreInstall
                        ? normalizedInstallSource || 'store'
                        : 'local'
                if (metadata.installSource !== resolvedInstallSource) {
                    metadata.installSource = resolvedInstallSource
                    metadataChanged = true
                }

                const resolvedId =
                    metadata.name === 'Default'
                        ? 'default'
                        : resolvedInstallSource === 'store'
                          ? resolveAddonCanonicalId(metadata, metadata.id)
                          : resolveAddonStableId(metadata, metadata.id)
                if (metadata.id !== resolvedId) {
                    metadata.id = resolvedId
                    metadataChanged = true
                }

                const desiredFolder =
                    metadata.name === 'Default'
                        ? 'Default'
                        : resolveAddonDirectoryKey(metadata, resolvedId, {
                              preferStoreId: resolvedInstallSource === 'store',
                          })
                if (desiredFolder && desiredFolder !== currentFolder) {
                    const desiredFolderPath = path.join(addonsFolderPath, desiredFolder)
                    if (!fs.existsSync(desiredFolderPath)) {
                        try {
                            await fs.promises.rename(addonFolderPath, desiredFolderPath)
                            currentFolder = desiredFolder
                            addonFolderPath = desiredFolderPath
                            metadataFilePath = path.join(addonFolderPath, 'metadata.json')
                        } catch (error: any) {
                            const sourceMissing = error?.code === 'ENOENT'
                            const destinationReady = fs.existsSync(desiredFolderPath)

                            if (sourceMissing && destinationReady) {
                                currentFolder = desiredFolder
                                addonFolderPath = desiredFolderPath
                                metadataFilePath = path.join(addonFolderPath, 'metadata.json')
                            } else {
                                throw error
                            }
                        }
                    } else {
                        logger.main.warn(
                            `Addons: skipped directory migration from ${currentFolder} to ${desiredFolder} because target already exists.`,
                        )
                    }
                }

                const versionMatch = metadata.version.match(versionRegex)
                if (!versionMatch) {
                    logger.main.log(`Addons: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`)
                    metadata.version = '1.0.0'
                    metadataChanged = true
                } else {
                    metadata.version = versionMatch[0]
                }

                if (metadataChanged) {
                    await fs.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 4), 'utf-8').catch(err => {
                        logger.main.error(`Addons: error writing metadata.json in theme ${currentFolder}:`, err)
                    })
                }

                metadata.lastModified = diffString
                metadata.path = addonFolderPath
                metadata.size = formatSizeUnits(folderSize)
                metadata.directoryName = currentFolder
                metadata.dependencies = normalizeRelationValues(metadata.dependencies)
                metadata.conflictsWith = normalizeRelationValues(metadata.conflictsWith)
                metadata.allowedUrls = normalizeRelationValues(metadata.allowedUrls)
                metadata.supportedVersions = normalizeRelationValues(metadata.supportedVersions)
                try {
                    const rootEntries = await fs.promises.readdir(addonFolderPath, { withFileTypes: true })
                    metadata.rootFiles = rootEntries
                        .filter(entry => entry.isFile() && entry.name !== HANDLE_EVENTS_SETTINGS_FILENAME)
                        .map(entry => entry.name)
                } catch (err) {
                    logger.main.error(`Addons: error reading addon root files in theme ${currentFolder}:`, err)
                    metadata.rootFiles = []
                }

                previousAliases.forEach(alias => setAlias(alias, currentFolder))
                setAlias(currentFolder, currentFolder)
                setAlias(metadata.id, currentFolder)

                availableAddons.push(metadata)
            } catch (err) {
                logger.main.error(`Addons: error reading or parsing metadata.json in theme ${folder}:`, err)
            }
        } else {
            logger.main.error(`Addons: metadata.json not found in theme ${folder}`)
        }
    }

    const resolveStoredAddonKey = (value: unknown): string => {
        const raw = String(value || '').trim()
        if (!raw) return ''
        return aliasMap.get(raw) || aliasMap.get(raw.toLowerCase()) || raw
    }

    const choosePreferredAddon = (left: Addon, right: Addon): Addon => {
        const leftPriority = left.installSource === 'store' ? 2 : 1
        const rightPriority = right.installSource === 'store' ? 2 : 1

        if (leftPriority !== rightPriority) {
            return leftPriority > rightPriority ? left : right
        }

        return left.directoryName.localeCompare(right.directoryName) <= 0 ? left : right
    }

    const cleanupShadowedAddonDirectory = async (shadowedAddon: Addon, preferredAddon: Addon, reason: 'identity' | 'fingerprint') => {
        if (!shadowedAddon?.directoryName || shadowedAddon.directoryName === preferredAddon.directoryName) {
            return
        }

        const shadowedPath = path.join(addonsFolderPath, shadowedAddon.directoryName)
        if (!fs.existsSync(shadowedPath)) {
            return
        }

        try {
            await fs.promises.rm(shadowedPath, { recursive: true, force: true })
            logger.main.info(
                `Addons: removed duplicate ${reason} folder ${shadowedAddon.directoryName}. Keeping ${preferredAddon.directoryName}.`,
            )
        } catch (error) {
            logger.main.warn(
                `Addons: failed to remove duplicate ${reason} folder ${shadowedAddon.directoryName}: ${String(error)}`,
            )
        }
    }

    const dedupedByCanonicalId = new Map<string, Addon>()
    for (const addon of availableAddons) {
        const canonicalId = resolveAddonCanonicalId(addon, addon.id)
        const existingAddon = dedupedByCanonicalId.get(canonicalId)
        if (!existingAddon) {
            dedupedByCanonicalId.set(canonicalId, addon)
            continue
        }

        const preferredAddon = choosePreferredAddon(existingAddon, addon)
        const shadowedAddon = preferredAddon === existingAddon ? addon : existingAddon

        setAlias(shadowedAddon.directoryName, preferredAddon.directoryName)
        setAlias(shadowedAddon.id, preferredAddon.directoryName)
        setAlias(shadowedAddon.storeAddonId, preferredAddon.directoryName)
        setAlias(shadowedAddon.name, preferredAddon.directoryName)

        await cleanupShadowedAddonDirectory(shadowedAddon, preferredAddon, 'identity')
        logger.main.info(
            `Addons: duplicate addon identity "${canonicalId}" detected for ${existingAddon.directoryName} and ${addon.directoryName}. Keeping ${preferredAddon.directoryName}.`,
        )

        dedupedByCanonicalId.set(canonicalId, preferredAddon)
    }

    const resolvedAddons = Array.from(dedupedByCanonicalId.values())
    const dedupedByPublicationFingerprint = new Map<string, Addon>()
    const finalAddons: Addon[] = []

    for (const addon of resolvedAddons) {
        const fingerprint = resolveAddonPublicationFingerprint(addon)
        if (!fingerprint) {
            finalAddons.push(addon)
            continue
        }

        const existingAddon = dedupedByPublicationFingerprint.get(fingerprint)
        if (!existingAddon) {
            dedupedByPublicationFingerprint.set(fingerprint, addon)
            finalAddons.push(addon)
            continue
        }

        const preferredAddon = choosePreferredAddon(existingAddon, addon)
        const shadowedAddon = preferredAddon === existingAddon ? addon : existingAddon

        setAlias(shadowedAddon.directoryName, preferredAddon.directoryName)
        setAlias(shadowedAddon.id, preferredAddon.directoryName)
        setAlias(shadowedAddon.storeAddonId, preferredAddon.directoryName)
        setAlias(shadowedAddon.name, preferredAddon.directoryName)

        await cleanupShadowedAddonDirectory(shadowedAddon, preferredAddon, 'fingerprint')
        logger.main.info(
            `Addons: duplicate publication fingerprint detected for ${existingAddon.directoryName} and ${addon.directoryName}. Keeping ${preferredAddon.directoryName}.`,
        )

        dedupedByPublicationFingerprint.set(fingerprint, preferredAddon)

        if (preferredAddon !== existingAddon) {
            const existingIndex = finalAddons.findIndex(item => item.directoryName === existingAddon.directoryName)
            if (existingIndex >= 0) {
                finalAddons[existingIndex] = preferredAddon
            }
        }
    }

    let selectedTheme = resolveStoredAddonKey(State.get('addons.theme') ?? 'Default') || 'Default'
    let selectedScripts: string[] | string = State.get('addons.scripts') ?? []

    const themeAddonExists = finalAddons.some(addon => addon.type === 'theme' && addon.directoryName === selectedTheme)
    if (!themeAddonExists) {
        selectedTheme = 'Default'
        State.set('addons.theme', selectedTheme)
    }

    if (typeof selectedScripts === 'string') {
        selectedScripts = selectedScripts
            .split(',')
            .map(item => resolveStoredAddonKey(item))
            .filter(Boolean)
    } else if (Array.isArray(selectedScripts)) {
        selectedScripts = selectedScripts.map(item => resolveStoredAddonKey(item)).filter(Boolean)
    } else {
        selectedScripts = []
    }

    selectedScripts = finalAddons
        .filter(addon => addon.type === 'script' && selectedScripts.includes(addon.directoryName!))
        .map(addon => addon.directoryName!)

    const addonByDirectory = new Map(finalAddons.map(addon => [addon.directoryName, addon]))
    const enabledScriptsSet = new Set<string>(selectedScripts)

    const getRelationDirectory = (value: unknown): string => {
        const resolvedValue = resolveStoredAddonKey(value)
        return addonByDirectory.has(resolvedValue) ? resolvedValue : ''
    }

    const getActiveAddons = (): Addon[] => {
        const active: Addon[] = []

        if (selectedTheme !== 'Default') {
            const activeTheme = addonByDirectory.get(selectedTheme)
            if (activeTheme) {
                active.push(activeTheme)
            }
        }

        enabledScriptsSet.forEach(directoryName => {
            const addon = addonByDirectory.get(directoryName)
            if (addon) {
                active.push(addon)
            }
        })

        return active
    }

    const deactivateAddon = (addon: Addon) => {
        if (addon.type === 'theme') {
            if (selectedTheme === addon.directoryName) {
                selectedTheme = 'Default'
            }
            return
        }

        enabledScriptsSet.delete(addon.directoryName!)
    }

    const addonConflictsWith = (source: Addon, target: Addon): boolean =>
        normalizeRelationValues(source.conflictsWith).some(conflictKey => getRelationDirectory(conflictKey) === target.directoryName)

    const addonsConflict = (left: Addon, right: Addon): boolean => addonConflictsWith(left, right) || addonConflictsWith(right, left)

    const hasActiveDependency = (addon: Addon, dependencyDirectory: string): boolean => {
        const dependencyAddon = addonByDirectory.get(dependencyDirectory)
        if (!dependencyAddon) {
            return false
        }

        return dependencyAddon.type === 'theme' ? selectedTheme === dependencyDirectory : enabledScriptsSet.has(dependencyDirectory)
    }

    const activateAddon = (addon: Addon, trail = new Set<string>()): boolean => {
        const addonDirectory = addon.directoryName
        if (!addonDirectory) return false
        if (trail.has(addonDirectory)) return true

        const nextTrail = new Set(trail)
        nextTrail.add(addonDirectory)

        const dependencyDirectories = normalizeRelationValues(addon.dependencies).map(getRelationDirectory)
        if (dependencyDirectories.some(directory => !directory)) {
            return false
        }

        for (const dependencyDirectory of dependencyDirectories) {
            const dependencyAddon = addonByDirectory.get(dependencyDirectory)
            if (!dependencyAddon) {
                return false
            }

            if (addon.type === 'theme' && dependencyAddon.type === 'theme' && dependencyAddon.directoryName !== addonDirectory) {
                return false
            }

            if (!activateAddon(dependencyAddon, nextTrail)) {
                return false
            }
        }

        for (const activeAddon of getActiveAddons()) {
            if (activeAddon.directoryName === addonDirectory) continue
            if (addonsConflict(addon, activeAddon)) {
                deactivateAddon(activeAddon)
            }
        }

        if (addon.type === 'theme') {
            selectedTheme = addonDirectory
        } else {
            enabledScriptsSet.add(addonDirectory)
        }

        return true
    }

    const requestedTheme = selectedTheme !== 'Default' ? addonByDirectory.get(selectedTheme) ?? null : null
    if (requestedTheme && !activateAddon(requestedTheme)) {
        selectedTheme = 'Default'
    }

    for (const scriptDirectory of selectedScripts) {
        const scriptAddon = addonByDirectory.get(scriptDirectory)
        if (!scriptAddon) continue

        activateAddon(scriptAddon)
    }

    let selectionChanged = true
    while (selectionChanged) {
        selectionChanged = false
        const activeAddons = getActiveAddons()

        for (const addon of activeAddons) {
            const hasMissingDependency = normalizeRelationValues(addon.dependencies)
                .map(getRelationDirectory)
                .some(dependencyDirectory => !dependencyDirectory || !hasActiveDependency(addon, dependencyDirectory))

            const hasConflict = activeAddons.some(otherAddon => otherAddon.directoryName !== addon.directoryName && addonsConflict(addon, otherAddon))

            if (hasMissingDependency || hasConflict) {
                deactivateAddon(addon)
                selectionChanged = true
            }
        }
    }

    selectedScripts = Array.from(enabledScriptsSet)
    State.set('addons.theme', selectedTheme)
    State.set('addons.scripts', selectedScripts)

    finalAddons.forEach(addon => {
        addon.enabled = false

        if (addon.type === 'theme' && addon.directoryName === selectedTheme) {
            addon.enabled = true
        } else if (addon.type === 'script' && enabledScriptsSet.has(addon.directoryName!)) {
            addon.enabled = true
        }
    })

    return finalAddons
}

export async function loadAddons(): Promise<Addon[]> {
    if (loadAddonsInFlight) {
        return loadAddonsInFlight
    }

    loadAddonsInFlight = (async () => {
        try {
            return await loadAddonsInternal()
        } finally {
            loadAddonsInFlight = null
        }
    })()

    return loadAddonsInFlight
}

export function sanitizeScript(js: string): string {
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

        function inspectCall(node: any): void {
            const callee = resolveCallee(node.callee)

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
        logger.http.warn('SUS script detected.')
        return ''
    }
    return js
}
