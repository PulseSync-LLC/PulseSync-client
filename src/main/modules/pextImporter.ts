import { fileURLToPath } from 'node:url'

import { app } from 'electron'

import AdmZip from 'adm-zip'
import * as fsp from 'fs/promises'
import fs from 'original-fs'
import path from 'path'

import { computeAddonPackageHash, resolveAddonDirectoryKey, resolveAddonPublicationFingerprint, resolveAddonStableId } from '../utils/addonIdentity'
import { getAddonsRoot, resolveExistingFileInsideBase } from '../utils/addonPaths'
import { findAddonByPublicationFingerprint } from '../utils/addonRegistry'
import { isValidWebHostAddonRuntime } from '../utils/webHostAddonRuntime'
import { readPreservedAddonSettings, restorePreservedAddonSettings } from './addonSettingsPreservation'
import { HandleErrorsElectron } from './handlers/handleErrorsElectron'
import logger from './logger'
import { getState } from './state'

const State = getState()
const SUPPORTED_ADDON_ARCHIVE_EXTENSIONS = new Set(['.pext', '.zip'])
const MAX_ADDON_ARCHIVE_BYTES = 100 * 1024 * 1024
type ImportAddonArchiveOptions = {
    installSource?: 'store' | 'local'
    storeAddonId?: string | null
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

const normalizeArchiveEntryName = (entryName: string): string | null => {
    const rawName = String(entryName || '').replace(/\\/g, '/')
    if (!rawName || rawName.includes('\0') || rawName.startsWith('/') || rawName.startsWith('//') || /^[a-zA-Z]:/.test(rawName)) {
        return null
    }

    const normalizedName = path.posix.normalize(rawName)
    if (
        !normalizedName ||
        normalizedName === '.' ||
        normalizedName === '..' ||
        normalizedName.startsWith('../') ||
        path.posix.isAbsolute(normalizedName)
    ) {
        return null
    }

    return normalizedName
}

const validateAddonArchive = (zip: AdmZip): boolean => {
    let hasRootMetadata = false
    let totalUncompressedSize = 0

    for (const entry of zip.getEntries()) {
        const normalizedName = normalizeArchiveEntryName(entry.entryName)
        if (!normalizedName) {
            logger.main.warn(`Rejected addon archive with unsafe entry: ${entry.entryName}`)
            return false
        }

        if (!entry.isDirectory && normalizedName === 'metadata.json') {
            hasRootMetadata = true
        }

        totalUncompressedSize += Number((entry.header as { size?: number }).size) || 0
        if (totalUncompressedSize > MAX_ADDON_ARCHIVE_BYTES) {
            logger.main.warn('Rejected addon archive because its unpacked size is too large')
            return false
        }
    }

    if (!hasRootMetadata) {
        logger.main.error('Missing metadata.json in addon archive')
        return false
    }

    return true
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
        const archiveBuffer = await fsp.readFile(filePath)
        if (archiveBuffer.byteLength > MAX_ADDON_ARCHIVE_BYTES) {
            logger.main.warn(`Rejected addon archive because it is too large: ${filePath}`)
            return null
        }

        const zip = new AdmZip(filePath)
        if (!validateAddonArchive(zip)) {
            return null
        }

        tempDir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'pext-import-'))
        const stagingDir = path.join(tempDir, 'staging')
        zip.extractAllTo(stagingDir, true)

        const metadataPath = path.join(stagingDir, 'metadata.json')
        if (!fs.existsSync(metadataPath)) {
            logger.main.error('Missing metadata.json in .pext archive')
            return null
        }

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        metadata.fromPext = true
        metadata.installSource = options.installSource === 'store' ? 'store' : 'local'
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
            if (!isValidWebHostAddonRuntime(scriptContent)) {
                logger.main.error('Rejected web-addon archive with an invalid WebHost runtime')
                return null
            }
        }

        metadata.id = resolveAddonStableId(metadata)
        metadata.packageHash = computeAddonPackageHash(archiveBuffer)

        let targetDirectoryOverride: string | null = null
        if (metadata.installSource === 'store') {
            const publicationFingerprint = resolveAddonPublicationFingerprint(metadata)
            const existingLocalAddon = findAddonByPublicationFingerprint(publicationFingerprint, 'local')

            if (existingLocalAddon) {
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
