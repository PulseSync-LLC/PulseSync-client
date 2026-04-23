import { app, BrowserWindow, dialog, ipcMain, Notification, shell, session, session as electronSession } from 'electron'
import logger from '../modules/logger'
import path from 'path'
import fs from 'original-fs'
import * as fsp from 'fs/promises'
import * as si from 'systeminformation'
import os from 'node:os'
import { v4 } from 'uuid'
import { musicPath, readBufResilient, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import AdmZip from 'adm-zip'
import isAppDev from '../utils/isAppDev'
import { execFile } from 'child_process'
import axios from 'axios'
import { HandleErrorsElectron } from '../modules/handlers/handleErrorsElectron'
import {
    checkMusic,
    findAppByName,
    getInstalledYmMetadata,
    getLinuxInstallerUrl,
    getYandexMusicAppDataPath,
    getYandexMusicLogsPath,
    isYandexMusicRunning,
    isLinux,
    isMac,
    uninstallApp,
} from '../utils/appUtils'
import { installExtension, updateExtensions } from 'electron-chrome-web-store'
import { inSleepMode, mainWindow } from '../modules/createWindow'
import { loadAddons } from '../utils/addonUtils'
import config, { isDevmark } from '@common/appConfig'
import { HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { getState } from '../modules/state'
import { get_current_track } from '../modules/httpServer'
import { getMacUpdater } from '../modules/updater/macOsUpdater'
import { isUiReady, markUiReady } from '../modules/uiReady'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'
import type { SubcomponentsMeta } from '../../common/types/subcomponentsMeta'
import { obsWidgetManager } from '../modules/obsWidget/obsWidgetManager'
import { YM_SETUP_DOWNLOAD_URLS } from '../constants/urls'
import { t } from '../i18n'
import { importAddonArchive, importPextFile, isPextFilePath } from '../modules/pextImporter'
import {
    getBuildUpdateChannel,
    getEffectiveUpdateChannel,
    getMacManifestUrl,
    getUpdateChannelOverride,
    setUpdateChannelOverride,
    shouldAllowDowngradeForCurrentChannel,
} from '../modules/updater/updateChannel'
import { getUpdateSource, setUpdateSource } from '../modules/updater/updateSource'
import { getModReleasesForSource } from '../modules/mod/network/releaseCatalog'
import { CLIENT_REPO, listStableGitHubReleases, normalizeGitHubTagVersion, resolveClientGitHubMacManifest } from '../modules/updater/githubReleaseResolver'
import { getFfmpegMeta, getYtDlpMeta } from '../modules/submodulesChecker'
import { beginBrowserAuthFlow, cancelBrowserAuthFlow } from '../modules/auth/browserAuth'

const updater = getUpdater()
const State = getState()
let reqModal = 0
export let updateAvailable = false
export let authorized = false
let pendingAddonOpen: string | null = null
let updaterStartListenerBound = false
const ADDON_TEMPLATE_DOWNLOAD_URL = 'https://codeload.github.com/PulseSync-LLC/PulseSync-ExampleAddon/zip/refs/heads/main'
const ADDON_TEMPLATE_DEFAULT_DIRECTORY_NAME = 'PulseSync-ExampleAddon'
const MOD_REPO = {
    owner: 'PulseSync-LLC',
    repo: 'PulseSync-mod',
} as const

const macUpdater = isMac()
    ? getMacUpdater({
          manifestUrl: getMacManifestUrl(getEffectiveUpdateChannel()),
          appName: 'PulseSync',
          attemptAutoInstall: false,
          onProgress: p => {
              try {
                  if (mainWindow) {
                      mainWindow.setProgressBar(p / 100)
                      mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, p)
                  }
              } catch {}
          },
          onStatus: s => {
              if (s === UpdateStatus.DOWNLOADING) {
                  mainWindow?.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true })
                  updateAvailable = true
              } else if (s === UpdateStatus.DOWNLOADED) {
                  mainWindow?.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                  updateAvailable = true
                  try {
                      if (mainWindow) mainWindow.setProgressBar(-1)
                  } catch {}
              }
          },
          onLog: m => logger.updater.info(m),
      })
    : null

const syncMacUpdaterFeed = () => {
    if (!macUpdater) {
        return
    }

    macUpdater.setManifestUrl(getMacManifestUrl(getEffectiveUpdateChannel()))
    macUpdater.setAllowDowngrade(shouldAllowDowngradeForCurrentChannel())
}

const getCurrentUpdateStatus = () => (isMac() ? macUpdater?.getStatus() ?? UpdateStatus.IDLE : updater.getStatus())

const ensureUpdateSourceSwitchAllowed = () => {
    const status = getCurrentUpdateStatus()
    if (status === UpdateStatus.CHECKING || status === UpdateStatus.DOWNLOADING) {
        throw new Error('UPDATE_SOURCE_BUSY')
    }
}

const resolveMacUpdateManifest = async (source = getUpdateSource()) => {
    if (source === 'github') {
        return resolveClientGitHubMacManifest(getEffectiveUpdateChannel())
    }

    syncMacUpdaterFeed()
    return null
}

export const getPath = (args: string) => {
    const savePath = app.getPath('userData')
    return path.resolve(`${savePath}/extensions/${args}`)
}

function launchExtensionBackgroundWorkers(session = electronSession.defaultSession) {
    return Promise.all(
        session.extensions.getAllExtensions().map(async extension => {
            const manifest = extension.manifest
            if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
                await session.serviceWorkers.startWorkerForScope(extension.url)
            }
        }),
    )
}

async function registerAppReadyEvents(): Promise<void> {
    const filter = { urls: ['*://pulsesync.dev/*', '*://*.pulsesync.dev/*'] }
    session.defaultSession.webRequest.onErrorOccurred(filter, details => {
        logger.http.error(`HTTP ERROR: ${details.error} — ${details.method} ${details.url} (from ${details.webContentsId})`)
    })
    if (isAppDev) {
        try {
            await installExtension('fmkadmapgofadopljbjfkapdkoienihi')
            await updateExtensions()
            await launchExtensionBackgroundWorkers()
        } catch (e) {
            logger.main.error(e)
        }
    }
}

const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
}

export const queueAddonOpen = (addonName: string): void => {
    pendingAddonOpen = addonName
    tryOpenPendingAddon()
}

const tryOpenPendingAddon = (): void => {
    if (!authorized || !isUiReady() || !pendingAddonOpen || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(RendererEvents.OPEN_ADDON, pendingAddonOpen)
    pendingAddonOpen = null
}

const allowedExternalProtocols = new Set(['http:', 'https:', 'yandexmusic:'])
const allowedMusicHosts = new Set(['desktop.app.music.yandex.net'])

const isSafeExternalUrl = (rawUrl: string): boolean => {
    try {
        const url = new URL(rawUrl)
        return allowedExternalProtocols.has(url.protocol)
    } catch {
        return false
    }
}

const isAllowedMusicDownloadUrl = (rawUrl: string): boolean => {
    try {
        const url = new URL(rawUrl)
        if (url.protocol !== 'https:') return false
        if (!allowedMusicHosts.has(url.hostname)) return false
        return (
            /^\/stable\/Yandex_Music_x64_[\d.]+\.exe$/i.test(url.pathname) ||
            /^\/stable\/Yandex_Music_universal_[\d.]+\.dmg$/i.test(url.pathname) ||
            /^\/stable\/Yandex_Music_amd64_[\d.]+\.deb$/i.test(url.pathname)
        )
    } catch {
        return false
    }
}

const resolveWithinBase = (baseDir: string, target: string): string | null => {
    const resolved = path.resolve(baseDir, target)
    const normalizedBase = path.resolve(baseDir)
    if (resolved === normalizedBase) return resolved
    return resolved.startsWith(normalizedBase + path.sep) ? resolved : null
}

const shouldIncludeAddonArchiveEntry = (relativePath: string): boolean => {
    if (!relativePath) return true

    const parts = relativePath.split(path.sep)
    if (parts.some(part => part.startsWith('.'))) {
        return false
    }

    return path.basename(relativePath) !== HANDLE_EVENTS_SETTINGS_FILENAME
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

const registerWindowEvents = (): void => {
    ipcMain.handle(MainEvents.ELECTRON_WINDOW_IS_MAXIMIZED, () => mainWindow.isMaximized())

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send(MainEvents.ELECTRON_WINDOW_MAXIMIZED)
    })

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send(MainEvents.ELECTRON_WINDOW_UNMAXIMIZED)
    })

    ipcMain.on(MainEvents.ELECTRON_WINDOW_MINIMIZE, () => {
        mainWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_EXIT, () => {
        logger.main.info(t('main.events.exitApp'))
        app.quit()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MAXIMIZE, () => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_CLOSE, (_event, val: boolean) => {
        if (val) {
            mainWindow.hide()
            return
        }

        app.quit()
    })
}

const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.ELECTRON_ISDEV, event => {
        event.returnValue = isAppDev || isDevmark
    })
    ipcMain.on(MainEvents.ELECTRON_ISMAC, async (event, args) => {
        event.returnValue = isMac()
    })
    ipcMain.handle(MainEvents.GET_VERSION, async () => app.getVersion())
    ipcMain.on(MainEvents.ELECTRON_ISLINUX, async (event, args) => {
        event.returnValue = isLinux()
    })
    ipcMain.on(MainEvents.GET_LAST_BRANCH, event => {
        event.returnValue = process.env.BRANCH
    })
    ipcMain.handle(MainEvents.GET_BUILD_CHANNEL, async () => getBuildUpdateChannel())
    ipcMain.handle(MainEvents.GET_EFFECTIVE_UPDATE_CHANNEL, async () => getEffectiveUpdateChannel())
    ipcMain.handle(MainEvents.GET_UPDATE_CHANNEL_OVERRIDE, async () => getUpdateChannelOverride())
    ipcMain.handle(MainEvents.GET_UPDATE_SOURCE, async () => getUpdateSource())
    ipcMain.handle(MainEvents.GET_UPDATE_STATUS, async () => getCurrentUpdateStatus())
    ipcMain.handle(MainEvents.GET_MOD_RELEASES, async () => getModReleasesForSource(getUpdateSource()))
    ipcMain.handle(MainEvents.GET_CLIENT_CHANGELOG, async () => {
        const releases = await listStableGitHubReleases(CLIENT_REPO)

        return releases.map(release => ({
            id: release.id,
            version: normalizeGitHubTagVersion(release.tag_name),
            changelog: release.body ?? '',
            createdAt: release.published_at ? new Date(release.published_at).getTime() : 0,
        }))
    })
    ipcMain.handle(MainEvents.GET_MOD_CHANGELOG, async () => {
        const releases = await listStableGitHubReleases(MOD_REPO)

        return releases.map(release => ({
            id: String(release.id),
            version: normalizeGitHubTagVersion(release.tag_name),
            description: release.body ?? '',
            createdAt: release.published_at ? new Date(release.published_at).getTime() : 0,
        }))
    })
    ipcMain.handle(MainEvents.SET_UPDATE_CHANNEL_OVERRIDE, async (_event, channel: string | null) => {
        const previousEffectiveChannel = getEffectiveUpdateChannel()
        const nextOverride = setUpdateChannelOverride(channel)
        const nextEffectiveChannel = getEffectiveUpdateChannel()

        if (previousEffectiveChannel !== nextEffectiveChannel) {
            await updater.clearPendingUpdate(`channel-switch:${previousEffectiveChannel}->${nextEffectiveChannel}`)
            macUpdater?.resetPendingUpdate()
            updateAvailable = false
        }

        updater.reloadFeed()
        if (getUpdateSource() === 'backend') {
            syncMacUpdaterFeed()
        }

        return {
            buildChannel: getBuildUpdateChannel(),
            overrideChannel: nextOverride,
            effectiveChannel: nextEffectiveChannel,
        }
    })
    ipcMain.handle(MainEvents.SET_UPDATE_SOURCE, async (_event, source: string | null) => {
        ensureUpdateSourceSwitchAllowed()

        const previousSource = getUpdateSource()
        const nextSource = setUpdateSource(source)

        if (previousSource !== nextSource) {
            await updater.clearPendingUpdate(`source-switch:${previousSource}->${nextSource}`)
            macUpdater?.resetPendingUpdate()
            updateAvailable = false
        }

        updater.reloadFeed()
        if (nextSource === 'backend') {
            syncMacUpdaterFeed()
        }

        return {
            source: nextSource,
        }
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_GET, (event, val) => {
        event.returnValue = State.get(val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_SET, (event, key, val) => {
        State.set(key, val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_DELETE, (event, key) => {
        State.delete(key)
    })
    ipcMain.handle(MainEvents.GET_SYSTEM_INFO, async () => ({
        appVersion: app.getVersion(),
        osType: os.type(),
        osRelease: os.release(),
        cpu: os.cpus(),
        memory: os.totalmem(),
        freeMemory: os.freemem(),
        arch: os.arch(),
    }))
    ipcMain.on(MainEvents.UI_READY, () => {
        markUiReady()
        tryOpenPendingAddon()
        get_current_track()
    })
}

const registerFileOperations = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.OPEN_EXTERNAL, async (_event, url: string) => {
        try {
            if (!isSafeExternalUrl(url)) {
                logger.main.warn(`Blocked opening external URL: ${url}`)
                return
            }
            await shell.openExternal(url)
        } catch (error) {
            logger.main.error('Error opening external URL:', error)
        }
    })

    ipcMain.on(MainEvents.OPEN_FILE, (_event, markdownContent: string) => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        fsp.writeFile(tempFilePath, markdownContent)
            .then(async () => {
                const openError = await shell.openPath(tempFilePath)
                if (openError) {
                    logger.main.error(`Error opening the file: ${openError}`)
                }
                setTimeout(async () => {
                    try {
                        await fsp.unlink(tempFilePath)
                        logger.main.log('Temporary file successfully deleted')
                    } catch (unlinkErr: any) {
                        if (unlinkErr?.code !== 'ENOENT') {
                            logger.main.error('Error deleting the file:', unlinkErr)
                        }
                    }
                }, 10000)
            })
            .catch(err => {
                logger.main.error('Error writing to file:', err)
            })
    })

    ipcMain.on(MainEvents.OPEN_PATH, async (_event, data: any) => {
        switch (data.action) {
            case 'openApplications': {
                await shell.openPath('/Applications')
                break
            }
            case 'openPath': {
                if (typeof data.path === 'string' && data.path.trim().length > 0) {
                    await shell.openPath(data.path)
                }
                break
            }
            case 'appPath': {
                const appPath = app.getAppPath()
                const pulseSyncPath = path.resolve(appPath, '../..')
                await shell.openPath(pulseSyncPath)
                break
            }
            case 'musicPath': {
                const musicDir = app.getPath('music')
                const downloadDir = path.join(musicDir, 'PulseSyncMusic')
                await shell.openPath(downloadDir)
                break
            }
            case 'addonsPath': {
                const themesFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                await shell.openPath(themesFolderPath)
                break
            }
            case 'theme': {
                const addonsRoot = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                const safeThemePath = resolveWithinBase(addonsRoot, data.themeName || '')
                if (!safeThemePath) {
                    logger.main.warn(`Blocked opening theme path: ${data.themeName}`)
                    break
                }
                await shell.openPath(safeThemePath)
                break
            }
            case 'obsWidgetPath': {
                const widgetPath = path.join(app.getPath('appData'), 'PulseSync', 'obs-widget')
                await shell.openPath(widgetPath)
                break
            }
            case 'privacySettings': {
                if (isMac()) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')
                }
                break
            }
        }
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_FILE, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_DIRECTORY, async (_evt, opts?: { defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })

    ipcMain.handle(MainEvents.DIALOG_SAVE_FILE, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePath } = await dialog.showSaveDialog({
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePath) return null
        return path.normalize(filePath)
    })

    ipcMain.handle(MainEvents.FILE_AS_DATA_URL, async (_evt, fullPath: string) => {
        if (!fullPath) return null
        try {
            const buf = await (async () => {
                return await readBufResilient(fullPath)
            })()
            const ext = path.extname(fullPath).toLowerCase()
            const mime = (mimeByExt as any)?.[ext] || 'application/octet-stream'
            return `data:${mime};base64,${buf.toString('base64')}`
        } catch (e) {
            console.error('[file:asDataUrl] resilient read error:', e)
            return null
        }
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_FILE_METADATA, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null

        const [fullPath] = filePaths
        const normalizedPath = path.normalize(fullPath)
        const searchSubstr = path.join('PulseSync', 'addons') + path.sep

        return normalizedPath.includes(searchSubstr) ? path.basename(normalizedPath) : normalizedPath
    })
}

const registerMediaEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.DOWNLOAD_YANDEX_MUSIC, async (event, downloadUrl?: string) => {
        let exeUrl = downloadUrl
        if (!exeUrl) {
            const { data } = await axios.get('https://desktop.app.music.yandex.net/stable/latest.yml')
            const match = data.match(/version:\s*([\d.]+)/)
            if (!match) throw new Error(t('main.events.latestYmlVersionNotFound'))
            exeUrl = isMac()
                ? `https://desktop.app.music.yandex.net/stable/Yandex_Music_universal_${match[1]}.dmg`
                : isLinux()
                  ? await getLinuxInstallerUrl()
                  : `https://desktop.app.music.yandex.net/stable/Yandex_Music_x64_${match[1]}.exe`
        } else if (!isAllowedMusicDownloadUrl(exeUrl)) {
            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, { success: false, error: t('main.events.invalidDownloadUrl') })
            return
        }

        const fileName = path.basename(exeUrl)
        const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

        try {
            await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true })
            const response = await axios.get(exeUrl, { responseType: 'stream' })
            const totalLength = parseInt(<string>response.headers['content-length'] || '0', 10)
            let downloadedLength = 0
            const writer = fs.createWriteStream(downloadPath)

            response.data.on('data', (chunk: Buffer) => {
                downloadedLength += chunk.length
                const progress = downloadedLength / totalLength
                event.reply(RendererEvents.DOWNLOAD_MUSIC_PROGRESS, { progress: Math.round(progress * 100) })
                mainWindow.setProgressBar(progress)
            })

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve)
                writer.on('error', reject)
                response.data.pipe(writer)
            })

            writer.close()
            mainWindow.setProgressBar(-1)
            fs.chmodSync(downloadPath, 0o755)

            setTimeout(async () => {
                if (process.platform === 'win32') {
                    execFile(downloadPath, error => {
                        if (error) {
                            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                                success: false,
                                error: t('main.events.fileExecuteFailed', { message: error.message }),
                            })
                            return
                        }
                        event.reply(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                            success: true,
                            message: t('main.events.fileExecutedSuccessfully'),
                        })
                        fs.unlinkSync(downloadPath)
                    })
                    return
                }

                const openError = await shell.openPath(downloadPath)
                if (openError) {
                    event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                        success: false,
                        error: t('main.events.fileOpenFailed', { message: openError }),
                    })
                    return
                }
                event.reply(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                    success: true,
                    message: t('main.events.fileOpenedSuccessfully'),
                })
                fs.unlinkSync(downloadPath)
            }, 100)
        } catch (error: any) {
            mainWindow.setProgressBar(-1)
            if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath)
            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                success: false,
                error: t('main.events.fileDownloadError', { message: error.message }),
            })
        }
    })
}

const registerDeviceEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.GET_MUSIC_DEVICE, event => {
        si.system().then(data => {
            event.returnValue = `os=${os.type()}; os_version=${os.version()}; manufacturer=${data.manufacturer}; model=${data.model}; clid=WindowsPhone; device_id=${data.uuid}; uuid=${v4(
                { random: Buffer.from(data.uuid) },
            )}`
        })
    })

    ipcMain.on(MainEvents.AUTO_START_APP, (_event, enabled: boolean) => {
        if (isAppDev) return
        if (isLinux()) return
        app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') })
    })

    ipcMain.handle(MainEvents.GET_MUSIC_STATUS, async () => {
        if (isLinux()) return true
        else return fs.existsSync(musicPath)
    })

    ipcMain.handle(MainEvents.GET_MUSIC_RUNNING_STATUS, async () => {
        return await isYandexMusicRunning()
    })

    ipcMain.handle(MainEvents.GET_MUSIC_VERSION, async () => {
        const metadata = await getInstalledYmMetadata()
        return metadata?.version
    })

    ipcMain.on(MainEvents.CHECK_MUSIC_INSTALL, () => {
        checkMusic()
    })
}

const registerUpdateEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.UPDATE_INSTALL, async () => {
        if (isMac()) {
            try {
                const installInfo = await macUpdater?.installUpdate()
                if (installInfo && mainWindow) {
                    mainWindow.webContents.send(RendererEvents.MAC_UPDATE_READY, installInfo)
                }
            } catch (e: any) {
                logger.updater.error(`macOS install error: ${e?.message || e}`)
            }
            return
        }
        updater.install()
    })

    ipcMain.on(MainEvents.CHECK_UPDATE, async (_event, args: { hard?: boolean; manual?: boolean }) => {
        if (!isMac()) {
            updater.reloadFeed()
        }
        await checkOrFindUpdate(args?.hard, args?.manual)
    })

    ipcMain.on(MainEvents.UPDATER_START, async () => {
        if (isMac()) {
            try {
                const githubManifest = await resolveMacUpdateManifest()
                const m = githubManifest ? macUpdater?.checkManifest(githubManifest) : await macUpdater?.checkForUpdates()
                if (m) {
                    mainWindow.webContents.send(RendererEvents.UPDATE_AVAILABLE, m.version)
                    mainWindow.flashFrame(true)
                    updateAvailable = true
                }
            } catch (e: any) {
                logger.updater.error(`macOS updater-start error: ${e?.message || e}`)
            }
            return
        }
        updater.start()
        if (!updaterStartListenerBound) {
            updaterStartListenerBound = true
            updater.onUpdate(version => {
                mainWindow.webContents.send(RendererEvents.UPDATE_AVAILABLE, version)
                mainWindow.flashFrame(true)
                updateAvailable = true
            })
        }
    })
}

const registerLoggingEvents = (window: BrowserWindow): void => {
    const formatRendererLogMessage = (prefix: string, payload: Record<string, any> | null | undefined) => {
        const text = payload?.text ?? payload?.message ?? ''
        const details: string[] = []
        const type = payload?.type ? `type=${payload.type}` : null
        if (type) details.push(type)
        if (payload?.stack) details.push(`stack:\n${payload.stack}`)
        if (payload?.componentStack) details.push(`componentStack:\n${payload.componentStack}`)
        const detailText = details.length ? `\n${details.join('\n')}` : ''
        return `[${prefix}] ${text}${detailText}`.trim()
    }

    ipcMain.on(MainEvents.AUTH_STATUS, (_event, data: any) => {
        authorized = data.status
        tryOpenPendingAddon()
    })
    ipcMain.handle(MainEvents.START_BROWSER_AUTH, async () => {
        beginBrowserAuthFlow()
        return { success: true }
    })
    ipcMain.handle(MainEvents.CANCEL_BROWSER_AUTH, async () => {
        cancelBrowserAuthFlow()
        State.delete('tokens.token')
        authorized = false
        return { success: true }
    })

    ipcMain.on(MainEvents.RENDERER_LOG, (_event, data: any) => {
        const message = formatRendererLogMessage('RENDERER_LOG', data)
        const level = data?.error ? 'error' : data?.info ? 'info' : 'log'
        logger.renderer[level](message)
    })

    ipcMain.on(MainEvents.LOG_ERROR, (_event, errorInfo: any) => {
        const message = formatRendererLogMessage('LOG_ERROR', errorInfo)
        logger.renderer.error(message)
        const errorMessage = errorInfo?.message ?? t('main.events.rendererError')
        const error = new Error(errorMessage)
        if (errorInfo?.stack) {
            const componentStack = errorInfo?.componentStack ? `\nComponentStack:\n${errorInfo.componentStack}` : ''
            error.stack = `${errorInfo.stack}${componentStack}`
        }
        HandleErrorsElectron.handleError('renderer-error', errorInfo?.type ?? 'unknown', 'error-boundary', error)
    })
}

const registerNotificationEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.SHOW_NOTIFICATION, (_event, data: any) => {
        new Notification({ title: data.title, body: data.body }).show()
    })
    ipcMain.handle(MainEvents.NEED_MODAL_UPDATE, async () => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        }
        return false
    })
}

const registerLogArchiveEvent = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.GET_LOG_ARCHIVE, async () => {
        try {
            const logDirPath = path.join(app.getPath('appData'), 'PulseSync', 'logs')
            const now = new Date()
            const year = now.getFullYear()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const day = String(now.getDate()).padStart(2, '0')
            const archiveName = `logs-${year}-${month}-${day}.zip`
            const archivePath = path.join(logDirPath, archiveName)
            const userInfo = os.userInfo()
            const gpuData = await si.graphics()

            const systemInfo = {
                appVersion: app.getVersion(),
                osType: os.type(),
                osRelease: os.release(),
                cpu: os.cpus(),
                gpu: gpuData.controllers,
                freeMemory: os.freemem(),
                arch: os.arch(),
                platform: os.platform(),
                osInfo: await si.osInfo(),
                memInfo: await si.mem(),
                userInfo: { username: userInfo.username, homedir: userInfo.homedir },
            }

            const systemInfoPath = path.join(logDirPath, 'system-info.json')
            const configPulsePath = path.join(app.getPath('userData'), 'pulsesync_settings.json')
            const configYandexMusicPath = path.join(getYandexMusicAppDataPath(), 'config.json')
            const logsYandexMusicPath = getYandexMusicLogsPath()

            fs.writeFileSync(systemInfoPath, JSON.stringify(systemInfo, null, 4), 'utf-8')

            const zip = new AdmZip()
            zip.addLocalFolder(logDirPath, '', filePath => !filePath.endsWith('.zip') && filePath !== archiveName)
            zip.addLocalFolder(logsYandexMusicPath, 'yandexmusic/logs')
            zip.addLocalFile(configPulsePath, '')
            zip.addLocalFile(configYandexMusicPath, 'yandexmusic/')
            zip.writeZip(archivePath)
            shell.showItemInFolder(archivePath)
        } catch (error: any) {
            logger.main.error(`Error while creating archive file: ${error}`)
        }
    })
}

const registerSleepModeEvent = (window: BrowserWindow): void => {
    ipcMain.handle(MainEvents.CHECK_SLEEP_MODE, async () => inSleepMode)
}

const registerExtensionEvents = (window: BrowserWindow): void => {
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

            const zip = new AdmZip()

            zip.addLocalFolder(data.path, '', shouldIncludeAddonArchiveEntry)

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

            const zip = new AdmZip()
            zip.addLocalFolder(data.path, '', shouldIncludeAddonArchiveEntry)

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

    ipcMain.handle(MainEvents.INSTALL_STORE_ADDON, async (_event, payload: { id?: string; downloadUrl?: string; title?: string }) => {
        let tempArchivePath = ''

        try {
            const downloadUrl = payload?.downloadUrl?.trim()
            if (!downloadUrl) {
                return { success: false, reason: 'DOWNLOAD_URL_MISSING' }
            }

            const parsedUrl = new URL(downloadUrl)
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                return { success: false, reason: 'INVALID_PROTOCOL' }
            }

            const ext = path.extname(parsedUrl.pathname).toLowerCase() === '.pext' ? '.pext' : '.zip'
            tempArchivePath = path.join(app.getPath('temp'), `store-addon-${v4()}${ext}`)

            const response = await axios.get<ArrayBuffer>(downloadUrl, {
                responseType: 'arraybuffer',
            })

            await fsp.writeFile(tempArchivePath, Buffer.from(response.data))

            const addonName = await importAddonArchive(tempArchivePath, {
                installSource: 'store',
                storeAddonId: payload?.id || null,
            })
            if (!addonName) {
                return { success: false, reason: 'IMPORT_FAILED' }
            }

            queueAddonOpen(addonName)
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

const registerYandexMusicEvents = (window: BrowserWindow): void => {
    ipcMain.on('DELETE_YANDEX_MUSIC_APP', async _event => {
        try {
            logger.main.info(t('main.events.yandexUninstallStart'))

            const namePart = 'Yandex.Music'
            const pkg = await findAppByName(namePart)

            if (!pkg) {
                logger.main.warn(t('main.events.yandexNotFound'))
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: false,
                    message: t('main.events.yandexNotFoundMessage'),
                })
                return
            }

            try {
                logger.main.info(`Uninstalling Yandex Music: ${pkg.PackageFullName}`)
                await uninstallApp(pkg.PackageFullName)

                logger.main.info(t('main.events.yandexUninstallSuccess'))
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: true,
                    message: t('main.events.yandexUninstallSuccessMessage'),
                })
            } catch (uninstallErr) {
                logger.main.error(`Uninstall error: ${(uninstallErr as Error).message}`)
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: false,
                    message: t('main.events.yandexUninstallFailedWithReason', { message: (uninstallErr as Error).message }),
                })
            }
        } catch (error: any) {
            logger.main.error(`Uninstall exception: ${error.message}`)
            window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                success: false,
                message: t('main.events.yandexUninstallError'),
            })
        }
    })
    ipcMain.handle(MainEvents.GET_SUBCOMPONENTS_META, async () => {
        const meta: SubcomponentsMeta = {
            ffmpeg: await getFfmpegMeta(),
            ytdlp: await getYtDlpMeta(),
        }

        return meta
    })
}

export const handleEvents = (window: BrowserWindow): void => {
    registerWindowEvents()
    registerAppReadyEvents()
    registerSystemEvents(window)
    registerFileOperations(window)
    registerMediaEvents(window)
    registerDeviceEvents(window)
    registerUpdateEvents(window)
    registerLoggingEvents(window)
    registerNotificationEvents(window)
    registerLogArchiveEvent(window)
    registerSleepModeEvent(window)
    registerExtensionEvents(window)
    registerYandexMusicEvents(window)
    obsWidgetManager(window, app)
}

export const checkOrFindUpdate = async (hard?: boolean, manual = false) => {
    logger.updater.info('Check update')
    if (isMac()) {
        try {
            mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { checking: true, manual })
            const updateSource = getUpdateSource()
            const githubManifest = await resolveMacUpdateManifest(updateSource)
            const macUpdaterInstance = githubManifest ? macUpdater?.checkManifest(githubManifest) : await macUpdater?.checkForUpdates()
            if (macUpdaterInstance) {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
                updateAvailable = true
                try {
                    await macUpdater?.downloadUpdate(macUpdaterInstance)
                    mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                    if (hard) {
                        const installInfo = await macUpdater?.installUpdate(macUpdaterInstance)
                        if (installInfo && mainWindow) {
                            mainWindow.webContents.send(RendererEvents.MAC_UPDATE_READY, installInfo)
                        }
                    }
                } catch (e: any) {
                    logger.updater.error(`macOS download/install error: ${e?.message || e}`)
                    if (updateSource === 'backend') {
                        try {
                            const fallbackManifest = await resolveMacUpdateManifest('github')
                            const fallbackUpdate = fallbackManifest ? macUpdater?.checkManifest(fallbackManifest) : null
                            if (fallbackUpdate) {
                                logger.updater.warn('Primary backend macOS download failed, trying GitHub fallback')
                                await macUpdater?.downloadUpdate(fallbackUpdate)
                                mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                                if (hard) {
                                    const installInfo = await macUpdater?.installUpdate(fallbackUpdate)
                                    if (installInfo && mainWindow) {
                                        mainWindow.webContents.send(RendererEvents.MAC_UPDATE_READY, installInfo)
                                    }
                                }
                                return
                            }
                        } catch (fallbackError: any) {
                            logger.updater.error(`macOS GitHub fallback error: ${fallbackError?.message || fallbackError}`)
                        }
                    }
                    mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FAILED)
                    try {
                        if (mainWindow) mainWindow.setProgressBar(-1)
                    } catch {}
                }
            } else {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            }
        } catch (e: any) {
            logger.updater.error(`macOS check error: ${e?.message || e}`)
        }
        return
    }
    const status = await updater.check(manual)
    if (status === UpdateStatus.DOWNLOADED) {
        if (hard) updater.install()
        updateAvailable = true
    } else if (status === UpdateStatus.DOWNLOADING) {
        updateAvailable = true
    } else if (status === UpdateStatus.IDLE || status === null) {
        updateAvailable = false
    }
}
