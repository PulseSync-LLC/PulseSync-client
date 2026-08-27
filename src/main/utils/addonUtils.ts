import * as fs from 'original-fs'
import path from 'path'

import { HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'

import logger from '../modules/logger'
import { getState } from '../modules/state'
import { resolveAddonCanonicalId, resolveAddonDirectoryKey, resolveAddonPublicationFingerprint, resolveAddonStableId } from './addonIdentity'
import { getAddonsRoot, resolveExistingFileInsideBase } from './addonPaths'
import { formatSizeUnits, getFolderSize } from './appUtils'
import { validateWebHostAddonRuntime } from './webHostAddonRuntime'

export { sanitizeLegacyScript, sanitizeScript } from './legacyScriptSanitizer'

import type Addon from '@entities/addon/model/addon.interface'

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
    dependencies: [],
    conflictsWith: [],
    allowedUrls: [],
    supportedVersions: [],
}

const defaultCssContent = `{}`
let loadAddonsInFlight: Promise<Addon[]> | null = null

const normalizeRelationValues = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []

    return value.map(entry => String(entry || '').trim()).filter(Boolean)
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
                if (typeof metadata.script === 'string') {
                    const scriptPath = resolveExistingFileInsideBase(defaultAddonPath, metadata.script)
                    const script =
                        scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile() ? fs.readFileSync(scriptPath, 'utf-8') : ''
                    if (!script.trim()) {
                        delete metadata.script
                        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4), 'utf-8')
                    }
                }
            }
            return
        }

        fs.mkdirSync(defaultAddonPath, { recursive: true })
        fs.mkdirSync(path.join(defaultAddonPath, 'Assets'), { recursive: true })

        const cssPath = path.join(defaultAddonPath, defaultAddon.css!)
        fs.writeFileSync(metadataPath, JSON.stringify(defaultAddon, null, 4), 'utf-8')
        fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')

        logger.main.info(`Addons: default theme created at ${defaultAddonPath}.`)
    } catch (err) {
        logger.main.error(`Addons: error creating default theme at ${defaultAddonPath}:`, err)
    }
}

async function loadAddonsInternal(): Promise<Addon[]> {
    const addonsFolderPath = getAddonsRoot()

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
                    (currentFolder === String(metadata.storeAddonId).trim() ||
                        String(metadata.id || '').trim() === String(metadata.storeAddonId).trim())
                const resolvedInstallSource = normalizedInstallSource || inferredLegacyStoreInstall ? normalizedInstallSource || 'store' : 'local'
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

                if (metadata.type === 'theme' && typeof metadata.script === 'string' && metadata.script.trim()) {
                    const scriptPath = resolveExistingFileInsideBase(addonFolderPath, metadata.script)
                    if (scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile()) {
                        const script = await fs.promises.readFile(scriptPath, 'utf8')
                        if (!script.trim()) {
                            delete metadata.script
                            metadataChanged = true
                        }
                    }
                }

                if (metadataChanged) {
                    await fs.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 4), 'utf-8').catch(err => {
                        logger.main.error(`Addons: error writing metadata.json in theme ${currentFolder}:`, err)
                    })
                }

                metadata.lastModified = diffString
                metadata.lastModifiedAt = modificationDate.getTime()
                metadata.path = addonFolderPath
                metadata.size = formatSizeUnits(folderSize)
                metadata.directoryName = currentFolder
                metadata.dependencies = normalizeRelationValues(metadata.dependencies)
                metadata.conflictsWith = normalizeRelationValues(metadata.conflictsWith)
                metadata.allowedUrls = normalizeRelationValues(metadata.allowedUrls)
                metadata.supportedVersions = normalizeRelationValues(metadata.supportedVersions)
                metadata.runtime = 'legacy'
                if (metadata.type === 'theme' && typeof metadata.css === 'string') {
                    const cssPath = resolveExistingFileInsideBase(addonFolderPath, metadata.css)
                    const css = cssPath && fs.existsSync(cssPath) && fs.statSync(cssPath).isFile() ? await fs.promises.readFile(cssPath, 'utf8') : ''
                    const declaredScript = typeof metadata.script === 'string' && metadata.script.trim() ? metadata.script : null
                    const scriptPath = declaredScript ? resolveExistingFileInsideBase(addonFolderPath, declaredScript) : null
                    const scriptIsReadable = !declaredScript || Boolean(scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile())
                    const script =
                        scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile()
                            ? await fs.promises.readFile(scriptPath, 'utf8')
                            : ''
                    if (css.trim() && css.trim() !== '{}' && scriptIsReadable && !script.trim()) metadata.runtime = 'style'
                } else if (metadata.type === 'web-addon' && typeof metadata.script === 'string') {
                    const scriptPath = resolveExistingFileInsideBase(addonFolderPath, metadata.script)
                    if (scriptPath) {
                        try {
                            const scriptContent = await fs.promises.readFile(scriptPath, 'utf8')
                            const validation = validateWebHostAddonRuntime(scriptContent)
                            if (validation.ok) metadata.runtime = 'isolated'
                            else {
                                logger.main.warn(
                                    `[PulseSync Addons] Blocked isolated addon ${String(metadata.id || currentFolder)}: ${validation.category}: ${validation.reason}`,
                                )
                            }
                        } catch (err) {
                            logger.main.warn(`Addons: failed to validate WebHost runtime in ${currentFolder}: ${String(err)}`)
                        }
                    }
                }
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
            logger.main.info(`Addons: removed duplicate ${reason} folder ${shadowedAddon.directoryName}. Keeping ${preferredAddon.directoryName}.`)
        } catch (error) {
            logger.main.warn(`Addons: failed to remove duplicate ${reason} folder ${shadowedAddon.directoryName}: ${String(error)}`)
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
        .filter(addon => addon.type !== 'theme' && selectedScripts.includes(addon.directoryName!))
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

    const requestedTheme = selectedTheme !== 'Default' ? (addonByDirectory.get(selectedTheme) ?? null) : null
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
        } else if (addon.type !== 'theme' && enabledScriptsSet.has(addon.directoryName!)) {
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
