import os from 'node:os'
import { fileURLToPath } from 'node:url'

import * as fs from 'original-fs'
import * as path from 'path'

import RendererEvents from '../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../../shared/handlers/handleErrorsElectron'
import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import { CACHE_DIR } from '../constants/paths'
import { requirePulseSyncNative } from '../nativeModules/pulsesyncNative'
import { getState } from '../state'
import { isLinuxAccessError } from '../utils/appUtils/elevation'
import { resetProgress, sendToRenderer } from './download.helpers'
import { beginInstalledModMutation, readInstalledAsarChecksum } from './integrity'
import { ensureBackup, ensureLinuxModPath, installPreparedAsarAndPatchBundle, resolveBasePaths } from './mod-files'
import { closeMusicIfRunning, persistInstalledModState, sendSuccessAfterLaunch } from './mod-manager.helpers'
import { downloadAndExtractUnpacked } from './network'
import { prepareAsarArtifactInWorker } from './network/artifactWorkerClient'
import { resolveInstallModMatch } from './network/modCatalog'

import type { BrowserWindow } from 'electron'

const ACTION_PATCH = 'PATCH'
const PATCH_TYPE_FROM_MOD = 'FROM_MOD'

type InstallModUpdateFromSource = 'socket' | 'deeplink' | 'unknown'
const State = getState()
let installInProgress = false

export interface InstallModUpdateFromResult {
    success: boolean
    path?: string
    type?: string
    error?: string
}

const trimQuotes = (value: string): string => value.trim().replace(/^["']|["']$/g, '')

const decodeMaybe = (value: string): string => {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

const normalizeAction = (value: string): string => trimQuotes(value).replace(/-/g, '_').toUpperCase()

const toAsarPathCandidate = (rawValue: string): string | null => {
    const raw = trimQuotes(rawValue)
    if (!raw) return null

    let normalized: string
    if (raw.toLowerCase().startsWith('file://')) {
        try {
            normalized = path.normalize(fileURLToPath(raw))
        } catch {
            return null
        }
    } else {
        normalized = path.normalize(decodeMaybe(raw))
    }

    return /\.asar(?:\.zst)?$/iu.test(normalized.split(/[?#]/)[0] || '') ? normalized : null
}

const parseInstallCandidate = (raw: string): string | null => {
    const value = trimQuotes(raw)
    if (!value) return null
    if (value.toLowerCase().startsWith('pulsesync://')) {
        return extractInstallModUpdateFromDeepLink(value)
    }
    return toAsarPathCandidate(value)
}

const extractFromPayloadObject = (payload: Record<string, unknown>): string | null => {
    const directCandidates = [payload.fromAsarSrc, payload.path, payload.filePath, payload.asarPath, payload.asar]
    for (const raw of directCandidates) {
        if (typeof raw !== 'string') continue
        const candidate = parseInstallCandidate(raw)
        if (candidate) return candidate
    }

    const deeplinkCandidates = [payload.url, payload.deeplink, payload.link]
    for (const raw of deeplinkCandidates) {
        if (typeof raw !== 'string') continue
        const candidate = extractInstallModUpdateFromDeepLink(raw)
        if (candidate) return candidate
    }

    const args = payload.args
    if (typeof args === 'string') {
        const candidate = parseInstallCandidate(args)
        if (candidate) return candidate
    } else if (Array.isArray(args)) {
        for (const raw of [...args].reverse()) {
            if (typeof raw !== 'string') continue
            const candidate = parseInstallCandidate(raw)
            if (candidate) return candidate
        }
    } else if (args && typeof args === 'object') {
        const candidate = extractFromPayloadObject(args as Record<string, unknown>)
        if (candidate) return candidate
    }

    return null
}

const sendInstallFailure = (window: BrowserWindow | null | undefined, params: { error: string; type: string }): void => {
    sendToRenderer(window, RendererEvents.DOWNLOAD_FAILURE, { success: false, ...params })
    window?.setProgressBar(-1)
}

const sendInstallStarted = (window: BrowserWindow | null | undefined): void => {
    sendToRenderer(window, RendererEvents.MOD_INSTALL_STARTED, {
        success: true,
        isUpdate: Boolean(State.get('mod.installed')),
    })
}

export const extractInstallModUpdateFromDeepLink = (rawUrl: string): string | null => {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith('pulsesync://')) return null

    try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol !== 'pulsesync:') return null

        const pathParts = parsed.pathname.split('/').filter(Boolean)
        let patchTypeIndex = 0
        let isPatchCommand = normalizeAction(parsed.hostname) === ACTION_PATCH
        if (!isPatchCommand) {
            if (pathParts.length < 2) return null
            if (normalizeAction(pathParts[0]) !== ACTION_PATCH) return null
            patchTypeIndex = 1
            isPatchCommand = true
        }

        if (pathParts.length <= patchTypeIndex) return null
        if (normalizeAction(pathParts[patchTypeIndex]) !== PATCH_TYPE_FROM_MOD) return null

        const fromModPath = pathParts.slice(patchTypeIndex + 1).join('/')
        const candidate = toAsarPathCandidate(fromModPath)
        if (candidate) return candidate
    } catch {
        return null
    }

    return null
}

export const extractInstallModUpdateFromPayload = (payload: unknown): string | null => {
    if (typeof payload === 'string') {
        return parseInstallCandidate(payload)
    }

    if (payload && typeof payload === 'object') {
        return extractFromPayloadObject(payload as Record<string, unknown>)
    }

    return null
}

export const installModUpdateFromAsar = async (
    rawPath: string,
    window: BrowserWindow | null | undefined,
    source: InstallModUpdateFromSource = 'unknown',
): Promise<InstallModUpdateFromResult> => {
    if (installInProgress) {
        return { success: false, type: 'install_already_running' }
    }

    installInProgress = true
    try {
        return await runInstallModUpdateFromAsar(rawPath, window, source)
    } finally {
        installInProgress = false
        resetProgress(window)
    }
}

const runInstallModUpdateFromAsar = async (
    rawPath: string,
    window: BrowserWindow | null | undefined,
    source: InstallModUpdateFromSource,
): Promise<InstallModUpdateFromResult> => {
    sendInstallStarted(window)

    const asarPath = toAsarPathCandidate(rawPath)
    if (!asarPath) {
        const error = 'Invalid mod archive path'
        logger.modManager.warn(`[INSTALL_MOD_UPDATE_FROM:${source}] ${error}`, rawPath)
        sendInstallFailure(window, { error, type: 'invalid_path' })
        return { success: false, type: 'invalid_path', error }
    }

    if (!fs.existsSync(asarPath)) {
        const error = t('main.modManager.modAsarNotFound', { name: path.basename(asarPath) })
        logger.modManager.warn(`[INSTALL_MOD_UPDATE_FROM:${source}] asar not found: ${asarPath}`)
        sendInstallFailure(window, { error, type: 'file_not_found' })
        return { success: false, type: 'file_not_found', error }
    }

    let wasClosed = false
    const finishMutation = beginInstalledModMutation()

    try {
        const { incomingChecksum, matchedMod } = await resolveInstallModMatch(asarPath)

        if (!matchedMod) {
            const error = t('main.modManager.modVersionNotFoundByChecksum')
            sendInstallFailure(window, { error, type: 'unknown_checksum' })
            return { success: false, type: 'unknown_checksum', error }
        }

        if (matchedMod.channel === 'branch' && (!window || !matchedMod.downloadUnpackedUrl || !matchedMod.unpackedChecksum)) {
            throw new Error('Branch update requires a window and verified unpacked artifact')
        }
        if (matchedMod.channel === 'branch' && typeof requirePulseSyncNative().validateAsarUnpacked !== 'function') {
            const error = t('main.modNetwork.patchError')
            sendInstallFailure(window, { error, type: 'native_module_update_required' })
            return { success: false, type: 'native_module_update_required', error }
        }

        const paths = await ensureLinuxModPath(await resolveBasePaths())
        wasClosed = await closeMusicIfRunning(window)
        await ensureBackup(paths)

        const preparedAsarPath = path.join(os.tmpdir(), `pulsesync-local-${process.pid}-${Date.now()}.asar`)
        let patched = false
        try {
            const prepared = await prepareAsarArtifactInWorker({
                archivePath: asarPath,
                archiveExtension: path.extname(asarPath).toLowerCase(),
                expectedChecksum: incomingChecksum,
                outputPath: preparedAsarPath,
            })
            patched = await installPreparedAsarAndPatchBundle(paths.modAsar, prepared.preparedPath, paths.backupAsar)
        } finally {
            await fs.promises.rm(preparedAsarPath, { force: true }).catch(() => {})
        }

        if (!patched) {
            const error = t('main.modNetwork.patchError')
            sendInstallFailure(window, { error, type: 'patch_error' })
            return { success: false, type: 'patch_error', error }
        }

        if (matchedMod.channel === 'branch' && matchedMod.downloadUnpackedUrl && window) {
            const unpackedOk = await downloadAndExtractUnpacked(
                window,
                matchedMod.downloadUnpackedUrl,
                path.join(os.tmpdir(), `pulsesync-unpacked-${process.pid}-${Date.now()}.zip`),
                path.join(os.tmpdir(), `pulsesync-unpacked-${process.pid}-${Date.now()}`),
                path.join(path.dirname(paths.modAsar), 'app.asar.unpacked'),
                matchedMod.unpackedChecksum,
                CACHE_DIR,
            )
            if (!unpackedOk) return { success: false, type: 'unpacked_install_error' }
        }

        const resolvedChecksum = await readInstalledAsarChecksum(paths.modAsar)
        await persistInstalledModState(paths, matchedMod, resolvedChecksum)

        await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.DOWNLOAD_SUCCESS, { success: true })
        logger.modManager.info(
            `[INSTALL_MOD_UPDATE_FROM:${source}] Installed from ${asarPath} -> ${paths.modAsar} as mod ${matchedMod.modVersion} (${resolvedChecksum})`,
        )
        return { success: true, path: asarPath }
    } catch (error: any) {
        logger.modManager.error(`[INSTALL_MOD_UPDATE_FROM:${source}] Failed to install ${asarPath}`, error)
        if (error?.code === 'file_not_found') {
            const message =
                typeof error?.message === 'string' && error.message ? error.message : t('main.modManager.modAsarNotFound', { name: 'app.asar' })
            sendInstallFailure(window, { error: message, type: 'file_not_found' })
            return { success: false, type: 'file_not_found', error: message }
        }
        if (isLinuxAccessError(error)) {
            const message = t('main.modManager.linuxPermissionsRequired')
            sendInstallFailure(window, { error: message, type: 'linux_permissions_required' })
            return { success: false, type: 'linux_permissions_required', error: message }
        }
        HandleErrorsElectron.handleError('installModUpdateFrom', source, 'pipeline', error)
        const message = error?.message || String(error)
        sendInstallFailure(window, { error: message, type: 'install_mod_update_from_error' })
        return { success: false, type: 'install_mod_update_from_error', error: message }
    } finally {
        finishMutation()
    }
}
