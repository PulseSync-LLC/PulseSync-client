import { BrowserWindow } from 'electron'
import * as fs from 'original-fs'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import RendererEvents from '../../../common/types/rendererEvents'
import { t } from '../../i18n'
import { isLinuxAccessError } from '../../utils/appUtils/elevation'
import logger from '../logger'
import { getState } from '../state'
import { sendToRenderer } from './download.helpers'
import { closeMusicIfRunning, readChecksum, sendSuccessAfterLaunch } from './mod-manager.helpers'
import { ensureBackup, ensureLinuxModPath, resolveBasePaths, writePatchedAsarAndPatchBundle } from './mod-files'

const State = getState()
const ACTION_PATCH = 'PATCH'
const PATCH_TYPE_FROM_MOD = 'FROM_MOD'

type InstallModUpdateFromSource = 'socket' | 'deeplink' | 'unknown'

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

    const ext = path.extname(normalized.split(/[?#]/)[0] || '').toLowerCase()
    return ext === '.asar' ? normalized : null
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
    const asarPath = toAsarPathCandidate(rawPath)
    if (!asarPath) {
        const error = 'Invalid .asar path'
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

    try {
        const paths = await ensureLinuxModPath(await resolveBasePaths())
        wasClosed = await closeMusicIfRunning(window)
        await ensureBackup(paths)

        const incomingAsar = await fs.promises.readFile(asarPath)
        const sourceUrl = pathToFileURL(asarPath).toString()
        const patched = await writePatchedAsarAndPatchBundle(paths.modAsar, incomingAsar, sourceUrl, paths.backupAsar)

        if (!patched) {
            const error = t('main.modNetwork.patchError')
            sendInstallFailure(window, { error, type: 'patch_error' })
            return { success: false, type: 'patch_error', error }
        }

        const checksum = readChecksum(paths.modAsar)
        const prevMod = (State.get('mod') as Record<string, unknown> | undefined) ?? {}
        State.set('mod', {
            ...prevMod,
            installed: true,
            ...(checksum ? { checksum } : {}),
        })

        await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.DOWNLOAD_SUCCESS, { success: true })
        logger.modManager.info(`[INSTALL_MOD_UPDATE_FROM:${source}] Installed from ${asarPath} -> ${paths.modAsar}`)
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
        const message = error?.message || String(error)
        sendInstallFailure(window, { error: message, type: 'install_mod_update_from_error' })
        return { success: false, type: 'install_mod_update_from_error', error: message }
    }
}
