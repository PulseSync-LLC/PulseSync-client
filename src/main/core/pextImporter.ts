import { fileURLToPath } from 'node:url'

import { app } from 'electron'

import * as fsp from 'fs/promises'
import fs from 'original-fs'
import path from 'path'

import { HandleErrorsElectron } from '../shared/handlers/handleErrorsElectron'
import logger from '../shared/logger'
import { AddonWorkerError, extractAddonArchiveInWorker } from './addons/addonWorkerClient'
import { readPreservedAddonSettings, restorePreservedAddonSettings } from './addonSettingsPreservation'
import { getState } from './state'
import { resolveAddonDirectoryKey, resolveAddonPublicationFingerprint, resolveAddonStableId } from './utils/addonIdentity'
import { getAddonsRoot, resolveExistingFileInsideBase } from './utils/addonPaths'
import { findAddonByPublicationFingerprint } from './utils/addonRegistry'
import { classifyAddonRuntime } from './utils/addonRuntime'
import { AddonUpdatePolicyError } from './utils/legacyAddonUpdatePolicy'
import { validateWebHostAddonRuntime } from './utils/webHostAddonRuntime'

const State = getState()
const SUPPORTED_ADDON_ARCHIVE_EXTENSIONS = new Set(['.pext', '.zip'])

export class LocalAddonConflictError extends Error {
    constructor() {
        super('LOCAL_ADDON_CONFLICT')
    }
}

type ImportAddonArchiveOptions = {
    releaseChannel?: 'stable' | 'dev'
    installSource?: 'store' | 'local'
    storeAddonId?: string | null
    preserveLocalAddons?: boolean
    validateLegacyStoreUpdate?: () => Promise<void>
}

export const normalizePextPath = (rawPath: string): string => {
    if (!rawPath) return ''
    const trimmed = rawPath.trim().replace(/^["']|["']$/g, '')
    if (trimmed.toLowerCase().startsWith('file://')) {
        try {
            return path.normalize(fileURLToPath(trimmed))
        } catch {
            return trimmed
        }
    }
    return trimmed
}

export const isPextFilePath = (rawPath: string): boolean => {
    const normalized = normalizePextPath(rawPath)
    return !!normalized && path.extname(normalized).toLowerCase() === '.pext'
}

export const isAddonArchivePath = (rawPath: string): boolean => {
    const normalized = normalizePextPath(rawPath)
    return !!normalized && SUPPORTED_ADDON_ARCHIVE_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

const removeSourcePextIfNeeded = async (filePath: string): Promise<void> => {
    if (!State.get('settings.deletePextAfterImport')) return
    try {
        await fsp.rm(filePath, { force: true })
    } catch (err: any) {
        logger.main.error(`Error deleting .pext file after import: ${err?.message || err}`)
        HandleErrorsElectron.handleError('pextImporter', 'removeSourcePextIfNeeded', 'removeSourcePextIfNeeded', err)
    }
}

const replaceAddonDirectory = async (stagingDir: string, outputDir: string): Promise<void> => {
    await fsp.mkdir(path.dirname(outputDir), { recursive: true })

    const moveAddonDirectory = async (sourceDir: string, destinationDir: string): Promise<void> => {
        try {
            await fsp.rename(sourceDir, destinationDir)
            return
        } catch (error: any) {
            if (error?.code !== 'EXDEV') throw error
        }

        await fsp.cp(sourceDir, destinationDir, { recursive: true })
        await fsp.rm(sourceDir, { recursive: true, force: true })
    }

    if (!fs.existsSync(outputDir)) {
        await moveAddonDirectory(stagingDir, outputDir)
        return
    }

    const backupDir = path.join(path.dirname(outputDir), `.${path.basename(outputDir)}.backup-${Date.now()}-${process.pid}`)
    await fsp.rename(outputDir, backupDir)

    try {
        await moveAddonDirectory(stagingDir, outputDir)
        await fsp.rm(backupDir, { recursive: true, force: true })
    } catch (error) {
        if (fs.existsSync(outputDir)) {
            await fsp.rm(outputDir, { recursive: true, force: true })
        }
        await fsp.rename(backupDir, outputDir)
        throw error
    }
}

export const importAddonArchive = async (rawPath: string, options: ImportAddonArchiveOptions = {}): Promise<string | null> => {
    const filePath = normalizePextPath(rawPath)
    if (!isAddonArchivePath(filePath)) return null
    if (!fs.existsSync(filePath)) {
        logger.main.warn(`Addon archive not found: ${filePath}`)
        return null
    }

    let tempDir = ''
    const ext = path.extname(filePath).toLowerCase()

    try {
        tempDir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'pext-import-'))
        const stagingDir = path.join(tempDir, 'staging')
        await fsp.mkdir(stagingDir)
        const packageHash = await extractAddonArchiveInWorker(path.resolve(filePath), stagingDir)

        const metadataPath = path.join(stagingDir, 'metadata.json')
        if (!fs.existsSync(metadataPath)) {
            logger.main.error('Missing metadata.json in .pext archive')
            return null
        }

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        metadata.fromPext = true
        metadata.installSource = options.installSource === 'store' ? 'store' : 'local'
        if (metadata.installSource === 'store') {
            metadata.storeReleaseChannel = options.releaseChannel === 'dev' ? 'dev' : 'stable'
        } else {
            delete metadata.storeReleaseChannel
        }
        if (options.storeAddonId) {
            metadata.storeAddonId = options.storeAddonId
        } else {
            delete metadata.storeAddonId
        }
        const addonName = typeof metadata.name === 'string' ? metadata.name.trim() : ''
        if (!addonName) {
            logger.main.error('Theme name missing in metadata.json')
            return null
        }

        if (metadata.type === 'web-addon') {
            const scriptPath = typeof metadata.script === 'string' ? resolveExistingFileInsideBase(stagingDir, metadata.script) : null
            const scriptContent = scriptPath ? await fsp.readFile(scriptPath, 'utf8') : ''
            const validation = await validateWebHostAddonRuntime(scriptContent)
            if (!validation.ok) {
                logger.main.error(
                    `[PulseSync Addons] Blocked isolated addon ${String(metadata.id || addonName)}: ${validation.category}: ${validation.reason}`,
                )
                return null
            }
        }
        if (metadata.type === 'theme' && typeof metadata.script === 'string' && metadata.script.trim()) {
            const scriptPath = resolveExistingFileInsideBase(stagingDir, metadata.script)
            const scriptContent = scriptPath && fs.existsSync(scriptPath) ? await fsp.readFile(scriptPath, 'utf8') : ''
            if (scriptContent.trim()) {
                logger.main.warn(
                    `[PulseSync Addons] Theme ${String(metadata.id || addonName)} contains JavaScript and will use legacy compatibility mode. Use type web-addon for JS + CSS packages.`,
                )
            }
        }

        metadata.id = resolveAddonStableId(metadata)
        metadata.packageHash = packageHash

        let targetDirectoryOverride: string | null = null
        if (metadata.installSource === 'store') {
            const publicationFingerprint = resolveAddonPublicationFingerprint(metadata)
            const existingLocalAddon = findAddonByPublicationFingerprint(publicationFingerprint, 'local')

            if (existingLocalAddon) {
                if (options.preserveLocalAddons) throw new LocalAddonConflictError()
                targetDirectoryOverride = existingLocalAddon.directoryName
                logger.main.info(
                    `Replacing local addon ${existingLocalAddon.directoryName} with store publication ${String(metadata.storeAddonId || metadata.name)}`,
                )
            }
        }

        const addonDirectory =
            targetDirectoryOverride ||
            resolveAddonDirectoryKey(metadata, metadata.id, {
                preferStoreId: metadata.installSource === 'store',
            })
        const outputDir = path.join(getAddonsRoot(), addonDirectory)
        if (options.preserveLocalAddons && fs.existsSync(outputDir)) {
            const existingMetadata = JSON.parse(await fsp.readFile(path.join(outputDir, 'metadata.json'), 'utf8'))
            if (existingMetadata.installSource !== 'store' || existingMetadata.storeAddonId !== metadata.storeAddonId) {
                throw new LocalAddonConflictError()
            }
        }
        if (metadata.installSource === 'store' && options.validateLegacyStoreUpdate && fs.existsSync(outputDir)) {
            const targetRuntime = await classifyAddonRuntime(stagingDir, metadata)
            if (targetRuntime === 'legacy') {
                const existingMetadata = JSON.parse(await fsp.readFile(path.join(outputDir, 'metadata.json'), 'utf8'))
                if ((await classifyAddonRuntime(outputDir, existingMetadata)) === 'legacy') {
                    await options.validateLegacyStoreUpdate()
                }
            }
        }
        const preservedSettings = await readPreservedAddonSettings(outputDir)

        await restorePreservedAddonSettings(stagingDir, preservedSettings)
        await fsp.writeFile(path.join(stagingDir, 'metadata.json'), JSON.stringify(metadata, null, 4), 'utf8')
        await replaceAddonDirectory(stagingDir, outputDir)
        logger.main.info(`Extension imported successfully from ${ext} archive to ${outputDir}`)

        if (ext === '.pext') {
            await removeSourcePextIfNeeded(filePath)
        }

        return targetDirectoryOverride ? addonName : addonDirectory
    } catch (err: any) {
        if (err instanceof AddonWorkerError && err.invalidArchive) {
            logger.main.warn(`Rejected addon archive: ${err.message}`)
            return null
        }
        if (err instanceof AddonUpdatePolicyError || err instanceof LocalAddonConflictError) throw err
        logger.main.error(`Error in importAddonArchive: ${err?.message || err}`)
        HandleErrorsElectron.handleError('pextImporter', 'importAddonArchive', 'importAddonArchive', err)
        return null
    } finally {
        if (tempDir) {
            try {
                await fsp.rm(tempDir, { recursive: true, force: true })
            } catch (cleanupError) {
                logger.main.warn(`Unable to remove temporary .pext directory: ${String(cleanupError)}`)
            }
        }
    }
}

export const importPextFile = async (rawPath: string): Promise<string | null> => {
    const filePath = normalizePextPath(rawPath)
    if (!isPextFilePath(filePath)) return null
    return importAddonArchive(filePath, { installSource: 'local' })
}
