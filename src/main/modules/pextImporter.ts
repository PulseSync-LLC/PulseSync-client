import { app } from 'electron'
import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'original-fs'
import * as fsp from 'fs/promises'
import { fileURLToPath } from 'node:url'
import logger from './logger'
import { clearDirectory } from '../utils/appUtils'
import { getState } from './state'
import { HandleErrorsElectron } from './handlers/handleErrorsElectron'
import { computeAddonPackageHash, resolveAddonDirectoryKey, resolveAddonStableId } from '../utils/addonIdentity'

const State = getState()
const SUPPORTED_ADDON_ARCHIVE_EXTENSIONS = new Set(['.pext', '.zip'])
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
        const zip = new AdmZip(filePath)
        tempDir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'pext-import-'))
        zip.extractAllTo(tempDir, true)

        const metadataPath = path.join(tempDir, 'metadata.json')
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

        metadata.id = resolveAddonStableId(metadata)
        metadata.packageHash = computeAddonPackageHash(archiveBuffer)

        const addonDirectory = resolveAddonDirectoryKey(metadata)
        const outputDir = path.join(app.getPath('userData'), 'addons', addonDirectory)
        if (fs.existsSync(outputDir)) {
            await clearDirectory(outputDir)
        } else {
            await fsp.mkdir(outputDir, { recursive: true })
        }

        zip.extractAllTo(outputDir, true)
        fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 4))
        logger.main.info(`Extension imported successfully from ${ext} archive to ${outputDir}`)

        if (ext === '.pext') {
            await removeSourcePextIfNeeded(filePath)
        }

        return addonDirectory
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
