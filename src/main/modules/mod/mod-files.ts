import * as path from 'path'
import * as fs from 'original-fs'
import logger from '../logger'
import { getState } from '../state'
import { AsarPatcher, copyFile, getPathToYandexMusic, isLinux, resolveModAsarPath, updateIntegrityHashInExe } from '../../utils/appUtils'
import { t } from '../../i18n'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'

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
    const savedModPath = State.get('settings.modSavePath') as string | undefined
    const modAsar = resolveModAsarPath(musicPath, savedModPath)
    const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
    const infoPlistPath = path.join(musicPath, '..', 'Info.plist')
    return { music: musicPath, defaultAsar, modAsar, backupAsar, infoPlist: infoPlistPath }
}

export function isCompressedArchiveLink(link: string): boolean {
    const ext = path.extname(new URL(link).pathname).toLowerCase()
    return ext === '.gz' || ext === '.zst' || ext === '.zstd'
}

export async function ensureLinuxModPath(paths: Paths): Promise<Paths> {
    if (!isLinux()) return paths
    const saved = State.get('settings.modSavePath') as string | undefined
    const modAsar = resolveModAsarPath(paths.music, saved)
    const backupAsar = modAsar.replace(/\.asar$/, '.backup.asar')
    return { ...paths, modAsar, backupAsar }
}

export async function ensureBackup(paths: Paths): Promise<void> {
    if (fs.existsSync(paths.backupAsar)) {
        logger.modManager.info(`Backup already exists: ${path.basename(paths.backupAsar)}`)
        return
    }
    const source = fs.existsSync(paths.modAsar) ? paths.modAsar : fs.existsSync(paths.defaultAsar) ? paths.defaultAsar : null
    if (source === null) {
        const err: any = new Error(t('main.modFiles.asarNotFound', { name: path.basename(paths.modAsar) }))
        err.code = 'file_not_found'
        throw err
    }
    await copyFile(source, paths.backupAsar)
    logger.modManager.info(`Backup created ${path.basename(source)} -> ${path.basename(paths.backupAsar)}`)
}

export async function installPreparedAsarAndPatchBundle(savePath: string, preparedAsarPath: string, backupPath: string): Promise<boolean> {
    await copyFile(preparedAsarPath, savePath)

    const patcher = new AsarPatcher(path.resolve(path.dirname(savePath), '..', '..'))
    let ok: boolean
    try {
        ok = await patcher.patch(() => {})
    } catch (error) {
        HandleErrorsElectron.handleError('mod-files', 'installPreparedAsarAndPatchBundle', 'patch', error)
        ok = false
    }
    if (!ok) {
        if (fs.existsSync(backupPath)) await copyFile(backupPath, savePath)
        return false
    }
    return true
}

export async function restoreWindowsIntegrity(paths: Paths): Promise<void> {
    try {
        const exePath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'Яндекс Музыка.exe')
        await updateIntegrityHashInExe(exePath, paths.modAsar)
        logger.modManager.info('Windows Integrity hash restored.')
    } catch (err) {
        logger.modManager.error('Error restoring Integrity hash in exe:', err)
        HandleErrorsElectron.handleError('mod-files', 'restoreWindowsIntegrity', 'catch', err)
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
        HandleErrorsElectron.handleError('mod-files', 'restoreMacIntegrity', 'catch', err)
    }
}
