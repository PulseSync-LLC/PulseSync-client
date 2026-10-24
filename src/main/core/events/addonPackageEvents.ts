import { app, dialog, ipcMain, shell } from 'electron'

import AdmZip from 'adm-zip'
import axios from 'axios'
import * as fsp from 'fs/promises'
import fs from 'original-fs'
import path from 'path'
import { v4 } from 'uuid'

import { HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { branch } from '@common/appConfig'
import MainEvents from '@common/types/mainEvents'

import { HandleErrorsElectron } from '../../shared/handlers/handleErrorsElectron'
import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import mainHttpClient from '../http/client'
import { importAddonArchive, importPextFile, isPextFilePath } from '../pextImporter'
import { getState } from '../state'
import { loadAddons } from '../utils/addonUtils'
import { assertLegacyAddonUpdateAllowed } from '../utils/legacyAddonUpdatePolicy'

import type { DesktopInstallStoreAddonRequest } from '@common/desktopApi/contract'

const State = getState()
const ADDON_TEMPLATE_DOWNLOAD_URL = 'https://codeload.github.com/PulseSync-LLC/PulseSync-ExampleAddon/zip/refs/heads/main'
const ADDON_TEMPLATE_DEFAULT_DIRECTORY_NAME = 'PulseSync-ExampleAddon'
const EXCLUDED_ADDON_ARCHIVE_DIRECTORIES = new Set(['node_modules', 'bower_components', '__MACOSX'])
const EXCLUDED_ADDON_ARCHIVE_FILES = new Set([
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
    'Thumbs.db',
    'desktop.ini',
    HANDLE_EVENTS_SETTINGS_FILENAME,
])

const shouldIncludeAddonArchiveEntry = (relativePath: string): boolean => {
    if (!relativePath) return true

    const parts = relativePath.split(/[\\/]/)
    if (parts.some(part => part.startsWith('.') || EXCLUDED_ADDON_ARCHIVE_DIRECTORIES.has(part))) {
        return false
    }

    const fileName = parts[parts.length - 1]
    return !EXCLUDED_ADDON_ARCHIVE_FILES.has(fileName) && !fileName.endsWith('.tsbuildinfo')
}

const createAddonArchive = async (addonPath: string): Promise<AdmZip> => {
    const zip = new AdmZip()
    const directories = ['']

    while (directories.length) {
        const directory = directories.pop()!
        const entries = await fsp.readdir(path.join(addonPath, directory), { withFileTypes: true })
        for (const entry of entries) {
            const relativePath = path.join(directory, entry.name)
            if (!shouldIncludeAddonArchiveEntry(relativePath) || entry.isSymbolicLink()) continue

            const archivePath = relativePath.split(path.sep).join('/')
            if (entry.isDirectory()) {
                zip.addFile(`${archivePath}/`, Buffer.alloc(0))
                directories.push(relativePath)
            } else if (entry.isFile()) {
                zip.addLocalFile(path.join(addonPath, relativePath), path.posix.dirname(archivePath))
            }
        }
    }

    return zip
}

const getSuggestedAddonTemplatePath = (parentPath = app.getPath('documents')): string => {
    const basePath = path.join(parentPath, ADDON_TEMPLATE_DEFAULT_DIRECTORY_NAME)

    if (!fs.existsSync(basePath)) {
        return basePath
    }

    let counter = 2
    let candidatePath = `${basePath}-${counter}`
    while (fs.existsSync(candidatePath)) {
        counter += 1
        candidatePath = `${basePath}-${counter}`
    }

    return candidatePath
}

const ensureAddonTemplateDestination = async (targetPath: string): Promise<void> => {
    try {
        const stats = await fsp.stat(targetPath)
        if (!stats.isDirectory()) {
            throw new Error(t('main.events.addonTemplateDestinationBusy'))
        }

        const existingEntries = await fsp.readdir(targetPath)
        if (existingEntries.length > 0) {
            throw new Error(t('main.events.addonTemplateDestinationBusy'))
        }
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            await fsp.mkdir(targetPath, { recursive: true })
            return
        }

        throw error
    }
}

const extractAddonTemplateArchive = async (archiveBuffer: Buffer, targetPath: string): Promise<void> => {
    let tempDir = ''

    try {
        tempDir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'addon-template-'))
        const zip = new AdmZip(archiveBuffer)
        zip.extractAllTo(tempDir, true)

        const extractedEntries = await fsp.readdir(tempDir, { withFileTypes: true })
        const templateRoot =
            extractedEntries.length === 1 && extractedEntries[0].isDirectory() ? path.join(tempDir, extractedEntries[0].name) : tempDir

        const templateRootEntries = await fsp.readdir(templateRoot)
        if (!templateRootEntries.length) {
            throw new Error(t('main.events.addonTemplateArchiveInvalid'))
        }

        await ensureAddonTemplateDestination(targetPath)

        for (const entry of templateRootEntries) {
            await fsp.cp(path.join(templateRoot, entry), path.join(targetPath, entry), {
                force: true,
                recursive: true,
            })
        }
    } finally {
        if (tempDir) {
            await fsp.rm(tempDir, { recursive: true, force: true })
        }
    }
}

const scaffoldAddonTemplate = async (): Promise<{ canceled?: boolean; success: boolean; name?: string; path?: string; error?: string }> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        buttonLabel: t('main.common.ok'),
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        title: t('main.events.addonTemplateDirectoryDialogTitle'),
    })

    if (canceled || !filePaths.length) {
        return { canceled: true, success: false }
    }

    const selectedDirectory = path.normalize(filePaths[0])
    const targetPath = getSuggestedAddonTemplatePath(selectedDirectory)
    const response = await axios.get<ArrayBuffer>(ADDON_TEMPLATE_DOWNLOAD_URL, {
        responseType: 'arraybuffer',
    })

    await extractAddonTemplateArchive(Buffer.from(response.data), targetPath)
    await shell.openPath(targetPath)

    return {
        success: true,
        name: path.basename(targetPath),
        path: targetPath,
    }
}

export const registerAddonPackageEvents = ({
    isAuthorized,
    queueAddonOpen,
}: {
    isAuthorized: () => boolean
    queueAddonOpen: (addonName: string) => void
}): void => {
    ipcMain.handle(MainEvents.GET_ADDONS, async () => {
        try {
            return await loadAddons()
        } catch (error) {
            logger.main.error(t('main.events.addonsLoadError'), error)
        }
    })
    ipcMain.handle(MainEvents.CREATE_NEW_EXTENSION, async (_event, _args: any) => {
        try {
            return await scaffoldAddonTemplate()
        } catch (error: any) {
            HandleErrorsElectron.handleError('event-handler', MainEvents.CREATE_NEW_EXTENSION, 'try-catch', error)
            logger.main.error(t('main.events.createExtensionError'), error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle(MainEvents.EXPORT_ADDON, async (_event, data: any) => {
        try {
            if (!fs.existsSync(data.path)) {
                logger.main.error(t('main.events.folderNotFound'))
            }

            const zip = await createAddonArchive(data.path)

            const exportsDir = path.join(app.getPath('userData'), 'exports')
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true })

            const outputFilePath = path.join(exportsDir, data.name)
            const outputPath = path.format({
                dir: path.dirname(outputFilePath),
                name: path.basename(outputFilePath, '.pext'),
                ext: '.pext',
            })

            zip.writeZip(outputPath)
            logger.main.info(`Create theme ${outputPath}`)
            shell.showItemInFolder(outputPath)

            try {
                const zipPath = path.format({
                    dir: path.dirname(outputFilePath),
                    name: path.basename(outputFilePath, '.pext'),
                    ext: '.zip',
                })

                zip.writeZip(zipPath)
                logger.main.info(`Create zip ${zipPath}`)
                shell.showItemInFolder(zipPath)
            } catch (errZip: any) {
                logger.main.error(t('main.events.createZipError'), errZip)
            }

            return true
        } catch (error: any) {
            logger.main.error(t('main.events.createArchiveError'), error.message)
            return false
        }
    })

    ipcMain.handle(MainEvents.PACKAGE_ADDON_ARCHIVE, async (_event, data: { name?: string; path?: string }) => {
        try {
            if (!data?.path || !fs.existsSync(data.path)) {
                return { success: false, reason: 'ADDON_PATH_NOT_FOUND' }
            }

            const zip = await createAddonArchive(data.path)

            return {
                success: true,
                fileName: `${(data.name || path.basename(data.path)).replace(/[^\w.-]+/g, '_') || 'addon'}.zip`,
                base64: zip.toBuffer().toString('base64'),
            }
        } catch (error: any) {
            logger.main.error('Failed to package addon archive:', error)
            return { success: false, reason: error?.message || 'PACKAGE_FAILED' }
        }
    })

    ipcMain.handle(MainEvents.IMPORT_PEXT_FILE, async (_event, rawPath: string) => {
        try {
            if (!isPextFilePath(rawPath)) {
                return { success: false, reason: 'INVALID_FILE' }
            }
            const addonName = await importPextFile(rawPath)
            if (!addonName) {
                return { success: false, reason: 'IMPORT_FAILED' }
            }
            queueAddonOpen(addonName)
            return { success: true, addonName }
        } catch (error: any) {
            logger.main.error('Failed to import .pext from renderer drop:', error)
            return { success: false, reason: error?.message || 'IMPORT_FAILED' }
        }
    })

    ipcMain.handle(MainEvents.INSTALL_STORE_ADDON, async (_event, payload: DesktopInstallStoreAddonRequest) => {
        let tempArchivePath = ''

        try {
            const addonId = payload?.id?.trim().toLowerCase()
            if (!addonId) return { success: false, reason: 'STORE_ADDON_ID_MISSING' }
            const releaseChannel = payload.releaseChannel === 'dev' ? 'dev' : 'stable'
            const authToken = State.get('tokens.token')
            if (!isAuthorized() || typeof authToken !== 'string' || !authToken) return { success: false, reason: 'AUTH_REQUIRED' }

            let downloadUrl: string | null | undefined
            const reviewReleaseId = payload.reviewReleaseId?.trim().toLowerCase()
            if (reviewReleaseId) {
                const descriptor = await mainHttpClient.get<{
                    ok?: boolean
                    release?: { id: string; addonId: string; downloadUrl?: string | null }
                }>(`/extensions/${encodeURIComponent(addonId)}/releases/${encodeURIComponent(reviewReleaseId)}/review-download`, {
                    authToken,
                    timeoutMs: 15000,
                })
                const release = descriptor.data?.release
                if (descriptor.ok && descriptor.data?.ok === true && release?.addonId === addonId && release.id === reviewReleaseId) {
                    downloadUrl = release.downloadUrl
                }
            } else {
                const descriptor = await mainHttpClient.post<{
                    ok?: boolean
                    addons?: { id: string; currentRelease?: { downloadUrl?: string | null; status?: string } | null }[]
                }>('/extensions/updates', {
                    authToken,
                    headers: { 'x-pulsesync-channel': branch === 'dev' ? 'dev' : 'beta' },
                    body: { ids: [addonId], releaseChannel },
                    timeoutMs: 15000,
                })
                const addon = descriptor.data?.addons?.find(candidate => candidate.id === addonId)
                if (descriptor.ok && descriptor.data?.ok !== false && addon?.currentRelease?.status === 'accepted') {
                    downloadUrl = addon.currentRelease.downloadUrl
                }
            }
            if (!downloadUrl) return { success: false, reason: 'STORE_RELEASE_UNAVAILABLE' }
            if (State.get('tokens.token') !== authToken || !isAuthorized()) return { success: false, reason: 'AUTH_REQUIRED' }

            const parsedUrl = new URL(downloadUrl)
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                return { success: false, reason: 'INVALID_PROTOCOL' }
            }

            const ext = path.extname(parsedUrl.pathname).toLowerCase() === '.pext' ? '.pext' : '.zip'
            tempArchivePath = path.join(app.getPath('temp'), `store-addon-${v4()}${ext}`)

            const response = await axios.get<ArrayBuffer>(downloadUrl, {
                responseType: 'arraybuffer',
            })
            if (State.get('tokens.token') !== authToken || !isAuthorized()) return { success: false, reason: 'AUTH_REQUIRED' }

            await fsp.writeFile(tempArchivePath, Buffer.from(response.data))

            const addonName = await importAddonArchive(tempArchivePath, {
                installSource: 'store',
                storeAddonId: addonId,
                releaseChannel,
                validateLegacyStoreUpdate: reviewReleaseId
                    ? undefined
                    : () => assertLegacyAddonUpdateAllowed(authToken, payload.legacyAddonRestrictionsOverrideGroup),
            })
            if (!addonName) {
                return { success: false, reason: 'IMPORT_FAILED' }
            }

            if (payload.openAfterInstall !== false) queueAddonOpen(addonName)
            return { success: true, addonName }
        } catch (error: any) {
            logger.main.error(`Failed to install store addon "${payload?.title || 'unknown'}":`, error)
            return { success: false, reason: error?.message || 'INSTALL_FAILED' }
        } finally {
            if (tempArchivePath) {
                try {
                    await fsp.rm(tempArchivePath, { force: true })
                } catch (cleanupError) {
                    logger.main.warn(`Unable to remove temporary store addon archive: ${String(cleanupError)}`)
                }
            }
        }
    })
}
