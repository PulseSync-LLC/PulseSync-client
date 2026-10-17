import { dialog, ipcMain } from 'electron'

import * as fsp from 'fs/promises'
import * as fs from 'original-fs'
import path from 'path'
import process from 'process'

import { HANDLE_EVENTS_FILENAME, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import logger from '../../shared/logger'
import { sendAddonSettings, sendAllAddonSettings } from '../httpServer'
import { getAddonsRoot, resolveExistingDirectoryInsideBase, resolveExistingPathInsideBase, resolvePathInsideBase } from '../utils/addonPaths'
import { readBufResilient } from '../utils/readBufResilient'
import { registerAddonProjectEvents } from './addonProjectEvents'

const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
}

const ensureDir = async (p: string) => fsp.mkdir(path.dirname(p), { recursive: true })

function sanitizeAddonFilename(name: string) {
    return String(name || 'addon')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
}

const resolveAddonFilePath = (targetPath: string, options: { mustExist?: boolean } = {}): string | null => {
    const addonsRoot = getAddonsRoot()
    const resolvedPath = options.mustExist
        ? resolveExistingPathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
        : resolvePathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))

    return resolvedPath
}

const resolveWritableAddonFilePath = (targetPath: string): string | null => {
    const addonsRoot = getAddonsRoot()
    const resolvedPath = resolvePathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
    if (!resolvedPath) return null

    if (fs.existsSync(resolvedPath)) {
        return resolveExistingPathInsideBase(addonsRoot, resolvedPath)
    }

    let existingParent = path.dirname(resolvedPath)
    while (existingParent && !fs.existsSync(existingParent)) {
        const nextParent = path.dirname(existingParent)
        if (nextParent === existingParent) break
        existingParent = nextParent
    }

    return resolveExistingDirectoryInsideBase(addonsRoot, existingParent) ? resolvedPath : null
}

const resolveAddonDirectoryPath = (targetPath: string): string | null => {
    const addonsRoot = getAddonsRoot()
    return resolveExistingDirectoryInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
}

const toAddonRelativePath = (addonDirectoryPath: string, filePath: string): string | null => {
    const relativePath = path.relative(addonDirectoryPath, filePath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null
    }

    return relativePath.replace(/\\/g, '/')
}
const getInputPathCandidates = (p0: string): string[] => {
    if (!p0) return []
    const list: string[] = []
    if (p0.startsWith('file://')) {
        try {
            const u = new URL(p0)
            list.push(path.normalize(decodeURI(u.pathname)))
        } catch {}
    } else {
        list.push(path.normalize(p0))
    }
    const norm = list[0] || ''
    const variants = new Set<string>()
    if (norm) {
        variants.add(norm)
        if (process.platform === 'win32') {
            variants.add(norm.replace(/\//g, '\\'))
            variants.add(norm.replace(/\\/g, '/'))
            if (!norm.startsWith('\\\\?\\')) variants.add('\\\\?\\' + norm)
        }
        try {
            variants.add(norm.normalize('NFC'))
        } catch {}
        try {
            variants.add(norm.normalize('NFD'))
        } catch {}
        variants.add(norm.replace(/^["']|["']$/g, ''))
    }
    return Array.from(variants)
}

const resolveInputPath = (p0: string): string => {
    const variants = getInputPathCandidates(p0)
    for (const candidate of variants) {
        if (fs.existsSync(candidate)) return candidate
    }
    return variants[0] || ''
}
const mimeFromExt = (p: string) => {
    const ext = path.extname(p).toLowerCase()
    return (mimeByExt as any)?.[ext] || 'application/octet-stream'
}

const handleSettingsFilenames = new Set([HANDLE_EVENTS_FILENAME.toLowerCase(), HANDLE_EVENTS_SETTINGS_FILENAME.toLowerCase()])

const emitAddonSettingsWriteIfNeeded = (writtenPath: string): void => {
    if (!writtenPath) return

    const normalizedPath = path.normalize(writtenPath)
    if (!handleSettingsFilenames.has(path.basename(normalizedPath).toLowerCase())) {
        return
    }

    const addonsRoot = getAddonsRoot()
    const relativePath = path.relative(addonsRoot, normalizedPath)
    const isOutsideAddonsRoot = relativePath.startsWith('..') || path.isAbsolute(relativePath)
    if (isOutsideAddonsRoot) {
        return
    }

    const parts = relativePath.split(path.sep).filter(Boolean)
    const addonName = parts[0]
    if (!addonName) {
        sendAllAddonSettings({ force: true })
        return
    }

    sendAddonSettings({ addonName, force: true })
}

export function registerFileEvents(): void {
    registerAddonProjectEvents()
    ipcMain.handle(MainEvents.FILE_EVENT, async (_event, eventType, filePath: string) => {
        if (eventType !== RendererEvents.CHECK_FILE_EXISTS) {
            logger?.main?.error?.('[file-event] Unknown eventType:', eventType)
            return { success: false, error: 'Unknown eventType' }
        }

        try {
            for (const candidate of getInputPathCandidates(filePath)) {
                try {
                    if (fs.existsSync(candidate)) return true
                    await fsp.access(candidate, fs.constants.F_OK)
                    return true
                } catch {}
            }
        } catch (error) {
            logger?.main?.error?.('[file-event] Fatal:', eventType, error)
        }
        return false
    })

    ipcMain.handle(MainEvents.ADDON_FILE_EXISTS, async (_event, targetPath: string) => {
        return Boolean(resolveAddonFilePath(targetPath, { mustExist: true }))
    })

    ipcMain.handle(MainEvents.ADDON_FILE_READ_TEXT, async (_event, targetPath: string, encoding?: BufferEncoding) => {
        const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
        if (!filePath) return null

        try {
            return await fsp.readFile(filePath, encoding || 'utf8')
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger?.main?.error?.('[addon-file:read-text]', error)
            }
            return null
        }
    })

    ipcMain.handle(MainEvents.ADDON_FILE_WRITE_TEXT, async (_event, targetPath: string, content: string) => {
        const filePath = resolveWritableAddonFilePath(targetPath)
        if (!filePath) return { success: false, error: 'INVALID_ADDON_PATH' }

        try {
            await ensureDir(filePath)
            await fsp.writeFile(filePath, String(content ?? ''), 'utf8')
            emitAddonSettingsWriteIfNeeded(filePath)
            return { success: true }
        } catch (error: any) {
            logger?.main?.error?.('[addon-file:write-text]', error)
            return { success: false, error: error?.message || String(error) }
        }
    })

    ipcMain.handle(MainEvents.ADDON_FILE_READ_BASE64, async (_event, targetPath: string) => {
        const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
        if (!filePath) return null

        try {
            const buffer = await readBufResilient(filePath)
            return buffer.toString('base64')
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger?.main?.error?.('[addon-file:read-base64]', error)
            }
            return null
        }
    })

    ipcMain.handle(MainEvents.ADDON_FILE_WRITE_BASE64, async (_event, targetPath: string, base64: string) => {
        const filePath = resolveWritableAddonFilePath(targetPath)
        if (!filePath || !base64) return false

        try {
            await ensureDir(filePath)
            await fsp.writeFile(filePath, Buffer.from(base64, 'base64'))
            emitAddonSettingsWriteIfNeeded(filePath)
            return true
        } catch (error: any) {
            logger?.main?.error?.('[addon-file:write-base64]', error)
            return false
        }
    })

    ipcMain.handle(MainEvents.ADDON_FILE_AS_DATA_URL, async (_event, targetPath: string) => {
        const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
        if (!filePath) return null

        try {
            const buffer = await readBufResilient(filePath)
            return `data:${mimeFromExt(filePath)};base64,${buffer.toString('base64')}`
        } catch (error: any) {
            logger?.main?.error?.('[addon-file:as-data-url]', error)
            return null
        }
    })

    ipcMain.handle(
        MainEvents.ADDON_FILE_COPY_INTO,
        async (
            _event,
            request: {
                addonPath?: string
                existingRelativePath?: string
                preferredName?: string
                sourcePath?: string
            },
        ) => {
            const addonDirectoryPath = resolveAddonDirectoryPath(String(request?.addonPath || ''))
            const sourcePath = resolveInputPath(String(request?.sourcePath || ''))

            if (!addonDirectoryPath || !sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
                return { success: false, error: 'INVALID_ADDON_FILE_COPY' }
            }

            try {
                let destinationPath: string | null = null

                if (request?.existingRelativePath) {
                    if (path.isAbsolute(request.existingRelativePath)) {
                        return { success: false, error: 'INVALID_ADDON_RELATIVE_PATH' }
                    }
                    destinationPath = resolveWritableAddonFilePath(path.join(addonDirectoryPath, request.existingRelativePath))
                } else {
                    const baseName = sanitizeAddonFilename(request?.preferredName || path.basename(sourcePath))
                    const ext = path.extname(baseName)
                    const stem = baseName.slice(0, baseName.length - ext.length)
                    destinationPath = path.join(addonDirectoryPath, baseName)

                    let index = 1
                    while (index <= 500 && fs.existsSync(destinationPath)) {
                        destinationPath = path.join(addonDirectoryPath, `${stem}_${index++}${ext}`)
                    }
                    if (index > 500) {
                        destinationPath = path.join(addonDirectoryPath, `${stem}_${Date.now()}${ext}`)
                    }
                }

                if (!destinationPath || !resolvePathInsideBase(addonDirectoryPath, destinationPath)) {
                    return { success: false, error: 'INVALID_ADDON_DESTINATION' }
                }

                await ensureDir(destinationPath)
                try {
                    const buffer = await readBufResilient(sourcePath)
                    await fsp.writeFile(destinationPath, buffer)
                } catch {
                    await fsp.copyFile(sourcePath, destinationPath)
                }
                emitAddonSettingsWriteIfNeeded(destinationPath)

                const relativePath = toAddonRelativePath(addonDirectoryPath, destinationPath)
                return relativePath ? { success: true, relativePath } : { success: false, error: 'INVALID_ADDON_DESTINATION' }
            } catch (error: any) {
                logger?.main?.error?.('[addon-file:copy-into]', error)
                return { success: false, error: error?.message || String(error) }
            }
        },
    )

    ipcMain.handle(
        MainEvents.ADDON_FILE_OPEN_DIALOG,
        async (_event, request?: { defaultPath?: string; filters?: Electron.FileFilter[]; metadata?: boolean }) => {
            const addonsRoot = getAddonsRoot()
            const defaultPath = request?.defaultPath
                ? (resolvePathInsideBase(addonsRoot, resolveInputPath(request.defaultPath)) ?? undefined)
                : undefined
            const { canceled, filePaths } = await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: request?.filters,
                defaultPath,
            })
            if (canceled || !filePaths.length) return null

            const selectedPath = path.normalize(filePaths[0])
            if (!request?.metadata) {
                return selectedPath
            }

            return resolvePathInsideBase(addonsRoot, selectedPath) ? path.basename(selectedPath) : selectedPath
        },
    )
}
