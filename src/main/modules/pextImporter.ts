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

const State = getState()

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

const removeSourcePextIfNeeded = async (filePath: string): Promise<void> => {
    if (!State.get('settings.deletePextAfterImport')) return
    try {
        await fsp.rm(filePath, { force: true })
    } catch (err: any) {
        logger.main.error(`Error deleting .pext file after import: ${err?.message || err}`)
        HandleErrorsElectron.handleError('pextImporter', 'removeSourcePextIfNeeded', 'removeSourcePextIfNeeded', err)
    }
}

export const importPextFile = async (rawPath: string): Promise<string | null> => {
    const filePath = normalizePextPath(rawPath)
    if (!isPextFilePath(filePath)) return null
    if (!fs.existsSync(filePath)) {
        logger.main.warn(`Pext file not found: ${filePath}`)
        return null
    }

    let tempDir = ''

    try {
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
        const addonName = typeof metadata.name === 'string' ? metadata.name.trim() : ''
        if (!addonName) {
            logger.main.error('Theme name missing in metadata.json')
            return null
        }

        const outputDir = path.join(app.getPath('userData'), 'addons', addonName)
        if (fs.existsSync(outputDir)) {
            await clearDirectory(outputDir)
        } else {
            await fsp.mkdir(outputDir, { recursive: true })
        }

        zip.extractAllTo(outputDir, true)
        fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 4))
        logger.main.info(`Extension imported successfully to ${outputDir}`)

        await removeSourcePextIfNeeded(filePath)

        return addonName
    } catch (err: any) {
        logger.main.error(`Error in importPextFile: ${err?.message || err}`)
        HandleErrorsElectron.handleError('pextImporter', 'importPextFile', 'importPextFile', err)
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
