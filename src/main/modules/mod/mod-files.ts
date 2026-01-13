import { BrowserWindow, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import * as zlib from 'node:zlib'
import { promisify } from 'util'
import crypto from 'crypto'
import asar from '@electron/asar'
import logger from '../logger'
import { getState } from '../state'
import { AsarPatcher, getPathToYandexMusic, isLinux, updateIntegrityHashInExe } from '../../utils/appUtils'
import { DownloadError } from './download.helpers'
import { t } from '../../i18n'

export const gunzipAsync = promisify(zlib.gunzip)
export const zstdDecompressAsync = promisify((zlib as any).zstdDecompress || ((b: Buffer, cb: any) => cb(new Error('zstd not available'))))
const State = getState()

export type Paths = {
    music: string
    defaultAsar: string
    modAsar: string
    backupAsar: string
    infoPlist: string
}

export async function resolveBasePaths(): Promise<Paths> {
    const musicPath = await getPathToYandexMusic()
    const defaultAsar = path.join(musicPath, 'app.asar')
    const savedModPath = (State.get('settings.modSavePath') as string) || ''
    const modAsar = savedModPath || defaultAsar
    const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
    const infoPlistPath = path.join(musicPath, 'Contents', 'Info.plist')
    return { music: musicPath, defaultAsar, modAsar, backupAsar, infoPlist: infoPlistPath }
}

export function isCompressedArchiveLink(link: string): boolean {
    const ext = path.extname(new URL(link).pathname).toLowerCase()
    return ext === '.gz' || ext === '.zst' || ext === '.zstd'
}

export async function ensureLinuxModPath(window: BrowserWindow, paths: Paths): Promise<Paths> {
    if (!isLinux()) return paths
    const defaultExists = fs.existsSync(paths.defaultAsar)
    const saved = State.get('settings.modSavePath') as string | undefined

    if (!defaultExists && !saved) {
        const { response } = await dialog.showMessageBox(window, {
            type: 'info',
            title: t('main.modFiles.pickAsarTitle'),
            message: t('main.modFiles.pickAsarMessage'),
            buttons: [t('main.common.selectFile'), t('main.common.cancel')],
            noLink: true,
            normalizeAccessKeys: true,
        })
        if (response !== 0) return paths
        const fileRes = await dialog.showSaveDialog(window, {
            title: t('main.modFiles.saveAsTitle'),
            defaultPath: path.join(paths.music, 'app.asar'),
            filters: [{ name: 'ASAR Files', extensions: ['asar'] }],
        })
        if (fileRes.canceled || !fileRes.filePath) return paths
        const modAsar = fileRes.filePath
        const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
        State.set('settings', { modSavePath: modAsar })
        return { ...paths, modAsar, backupAsar }
    }

    if (!saved) {
        const modAsar = paths.defaultAsar
        const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
        return { ...paths, modAsar, backupAsar }
    }

    const modAsar = saved
    const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
    return { ...paths, modAsar, backupAsar }
}

export async function ensureBackup(paths: Paths): Promise<void> {
    if (fs.existsSync(paths.backupAsar)) {
        logger.modManager.info(`Backup already exists: ${path.basename(paths.backupAsar)}`)
        return
    }
    let source: string | null = null
    if (fs.existsSync(paths.modAsar)) source = paths.modAsar
    else if (fs.existsSync(paths.defaultAsar)) source = paths.defaultAsar
    if (!source) {
        const err: any = new Error(t('main.modFiles.asarNotFound', { name: path.basename(paths.modAsar) }))
        err.code = 'file_not_found'
        throw err
    }
    fs.copyFileSync(source, paths.backupAsar)
    logger.modManager.info(`Backup created ${path.basename(source)} -> ${path.basename(paths.backupAsar)}`)
}

export async function writePatchedAsarAndPatchBundle(
    window: BrowserWindow,
    savePath: string,
    rawDownloaded: Buffer,
    link: string,
    backupPath: string,
    expectedChecksum?: string,
): Promise<boolean> {
    let asarBuf: Buffer = rawDownloaded
    const ext = path.extname(new URL(link).pathname).toLowerCase()
    if (ext === '.gz') asarBuf = await gunzipAsync(rawDownloaded)
    else if (ext === '.zst' || ext === '.zstd') asarBuf = (await zstdDecompressAsync(rawDownloaded as any)) as any
    if (expectedChecksum) {
        const actualHash = crypto.createHash('sha256').update(asarBuf).digest('hex')
        if (actualHash !== expectedChecksum) {
            throw new DownloadError(
                `checksum mismatch (expected: ${expectedChecksum.substring(0, 8)}..., got: ${actualHash.substring(0, 8)}...)`,
                'checksum_mismatch',
            )
        }
    }
    fs.writeFileSync(savePath, asarBuf)
    const patcher = new AsarPatcher(path.resolve(path.dirname(savePath), '..', '..'))
    let ok = false
    try {
        ok = await patcher.patch(() => {})
    } catch {
        ok = false
    }
    if (!ok) {
        if (fs.existsSync(backupPath)) fs.renameSync(backupPath, savePath)
        return false
    }
    return true
}

export async function restoreWindowsIntegrity(paths: Paths): Promise<void> {
    try {
        const exePath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'Яндекс Музыка.exe')
        const header = asar.getRawHeader(paths.modAsar)
        const newHash = crypto.createHash('sha256').update(header.headerString).digest('hex')
        await updateIntegrityHashInExe(exePath, newHash)
        logger.modManager.info('Windows Integrity hash restored.')
    } catch (err) {
        logger.modManager.error('Error restoring Integrity hash in exe:', err)
    }
}

export async function restoreMacIntegrity(paths: Paths): Promise<void> {
    try {
        const appBundlePath = path.resolve(path.dirname(paths.modAsar), '..', '..')
        const patcher = new AsarPatcher(appBundlePath)
        await patcher.patch(() => {})
        logger.modManager.info('macOS Integrity hash restored.')
    } catch (err) {
        logger.modManager.error('Error restoring Integrity hash in Info.plist:', err)
    }
}
