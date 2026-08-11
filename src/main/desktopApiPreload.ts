import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import packageJson from '../../packages/desktop-core/package.json'
import { DESKTOP_API_VERSION, type DesktopSettingsPatch, type PulseSyncDesktopApi } from '../common/desktopApi/contract'
import MainEvents from '../common/types/mainEvents'
import RendererEvents from '../common/types/rendererEvents'
import type { ClientBuildIdentity } from '@common/types/clientBuildIdentity'
import type { ClientHardwareIdentity } from '@common/types/clientHardwareIdentity'
import { DESKTOP_CORE_VERSION, DESKTOP_HOST_VERSION } from '@common/desktopRuntime/version'

export const buildPackageJson = packageJson as typeof packageJson & {
    buildInfo?: {
        VERSION?: string
        BRANCH?: string
        BUILD_TIME?: string
        SIGNATURE?: string
    }
}

export const buildIdentity = (): ClientBuildIdentity => ({
    origin: 'PulseSync-LLC/PulseSync-client',
    version: buildPackageJson.buildInfo?.VERSION || PULSESYNC_VERSION || buildPackageJson.version,
    commit: buildPackageJson.buildInfo?.BRANCH || PULSESYNC_BRANCH || 'unknown',
    builtAt: buildPackageJson.buildInfo?.BUILD_TIME || '',
    signatureAlgorithm: 'ed25519',
    signature: buildPackageJson.buildInfo?.SIGNATURE || '',
})

const subscribe = (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
}

const subscribePayload = <T>(channel: string, listener: (payload: T) => void) =>
    subscribe(channel, (...args) => listener((args.length > 1 ? args : args[0]) as T))

const subscribeVoid = (channel: string, listener: () => void) => subscribe(channel, () => listener())

const trimTrailingPathSeparator = (value: string): string => value.replace(/[\\/]+$/, '')

const joinLinuxPath = (...parts: string[]): string =>
    parts.map((part, index) => (index === 0 ? trimTrailingPathSeparator(part) : part.replace(/^[\\/]+|[\\/]+$/g, ''))).join('/')

const getParentPath = (value: string): string => {
    const normalized = trimTrailingPathSeparator(value)
    const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
    return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : normalized
}

const applySettingsPatch = (patch: DesktopSettingsPatch): void => {
    if (patch.autoStartInTray !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.autoStartInTray', patch.autoStartInTray)
    if (patch.autoStartMusic !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.autoStartMusic', patch.autoStartMusic)
    if (patch.autoStartApp !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.autoStartApp', patch.autoStartApp)
    if (patch.hardwareAcceleration !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.hardwareAcceleration', patch.hardwareAcceleration)
    if (patch.deletePextAfterImport !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.deletePextAfterImport', patch.deletePextAfterImport)
    if (patch.autoUpdateStoreAddons !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.autoUpdateStoreAddons', patch.autoUpdateStoreAddons)
    if (patch.closeAppInTray !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.closeAppInTray', patch.closeAppInTray)
    if (patch.devSocket !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.devSocket', patch.devSocket)
    if (patch.askSavePath !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.askSavePath', patch.askSavePath)
    if (patch.saveAsMp3 !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.saveAsMp3', patch.saveAsMp3)
    if (patch.showModModalAfterInstall !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.showModModalAfterInstall', patch.showModModalAfterInstall)
    if (patch.saveWindowPositionOnRestart !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.saveWindowPositionOnRestart', patch.saveWindowPositionOnRestart)
    if (patch.saveWindowDimensionsOnRestart !== undefined)
        ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.saveWindowDimensionsOnRestart', patch.saveWindowDimensionsOnRestart)
    if (patch.modSavePath !== undefined) ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.modSavePath', patch.modSavePath)

    if (patch.autoStartApp !== undefined) {
        ipcRenderer.send(MainEvents.AUTO_START_APP, patch.autoStartApp)
    }
    if (patch.devSocket !== undefined) {
        ipcRenderer.send(patch.devSocket ? MainEvents.WEBSOCKET_START : MainEvents.WEBSOCKET_STOP)
    }
}

const selectLinuxAsarPath = async (defaultPath?: string): Promise<{ canceled: boolean; path: string | null }> => {
    const selectedPath = await ipcRenderer.invoke(MainEvents.DIALOG_OPEN_DIRECTORY, {
        defaultPath: defaultPath || '/opt/Яндекс Музыка',
    })

    if (!selectedPath || typeof selectedPath !== 'string') {
        return { canceled: true, path: null }
    }

    const asarCandidates = [joinLinuxPath(selectedPath, 'app.asar'), joinLinuxPath(selectedPath, 'resources', 'app.asar')]
    for (const candidate of asarCandidates) {
        const exists = await ipcRenderer.invoke(MainEvents.FILE_EVENT, RendererEvents.CHECK_FILE_EXISTS, candidate)
        if (exists) {
            return { canceled: false, path: getParentPath(candidate) }
        }
    }

    return { canceled: false, path: null }
}

const createPulseSyncDesktopApi = (): PulseSyncDesktopApi => ({
    apiVersion: DESKTOP_API_VERSION,
    async getRuntimeInfo() {
        const hardwareIdentity = (ipcRenderer.sendSync(MainEvents.GET_CLIENT_HARDWARE_IDENTITY) ?? null) as ClientHardwareIdentity | null
        const buildChannel = await ipcRenderer.invoke(MainEvents.GET_BUILD_CHANNEL).catch(() => null)

        return {
            apiVersion: DESKTOP_API_VERSION,
            hostVersion: DESKTOP_HOST_VERSION,
            coreVersion: DESKTOP_CORE_VERSION,
            buildChannel,
            platform: process.platform,
            isDev: Boolean(ipcRenderer.sendSync(MainEvents.ELECTRON_ISDEV)),
            isLinux: Boolean(ipcRenderer.sendSync(MainEvents.ELECTRON_ISLINUX)),
            isMac: Boolean(ipcRenderer.sendSync(MainEvents.ELECTRON_ISMAC)),
            buildIdentity: buildIdentity(),
            hardwareIdentity,
        }
    },
    lifecycle: {
        ready: () => ipcRenderer.send(MainEvents.UI_READY),
    },
    window: {
        minimize: () => ipcRenderer.send(MainEvents.ELECTRON_WINDOW_MINIMIZE),
        maximize: () => ipcRenderer.send(MainEvents.ELECTRON_WINDOW_MAXIMIZE),
        close: closeToTray => ipcRenderer.send(MainEvents.ELECTRON_WINDOW_CLOSE, closeToTray),
        exit: () => ipcRenderer.send(MainEvents.ELECTRON_WINDOW_EXIT),
        isMaximized: () => ipcRenderer.invoke(MainEvents.ELECTRON_WINDOW_IS_MAXIMIZED),
        onMaximized: listener => subscribeVoid(MainEvents.ELECTRON_WINDOW_MAXIMIZED, listener),
        onUnmaximized: listener => subscribeVoid(MainEvents.ELECTRON_WINDOW_UNMAXIMIZED, listener),
    },
    updates: {
        start: () => ipcRenderer.send(MainEvents.UPDATER_START),
        check: request => ipcRenderer.send(MainEvents.CHECK_UPDATE, request ?? {}),
        install: () => ipcRenderer.send(MainEvents.UPDATE_INSTALL),
        getStatus: () => ipcRenderer.invoke(MainEvents.GET_UPDATE_STATUS),
        getBuildChannel: () => ipcRenderer.invoke(MainEvents.GET_BUILD_CHANNEL),
        getEffectiveChannel: () => ipcRenderer.invoke(MainEvents.GET_EFFECTIVE_UPDATE_CHANNEL),
        getChannelOverride: () => ipcRenderer.invoke(MainEvents.GET_UPDATE_CHANNEL_OVERRIDE),
        setChannelOverride: channel => ipcRenderer.invoke(MainEvents.SET_UPDATE_CHANNEL_OVERRIDE, channel),
        getSource: () => ipcRenderer.invoke(MainEvents.GET_UPDATE_SOURCE),
        setSource: source => ipcRenderer.invoke(MainEvents.SET_UPDATE_SOURCE, source),
        getClientChangelog: () => ipcRenderer.invoke(MainEvents.GET_CLIENT_CHANGELOG),
        getModChangelog: () => ipcRenderer.invoke(MainEvents.GET_MOD_CHANGELOG),
        needModalUpdate: () => ipcRenderer.invoke(MainEvents.NEED_MODAL_UPDATE),
        onCheck: listener => subscribePayload(RendererEvents.CHECK_UPDATE, listener),
        onAvailable: listener => subscribePayload(RendererEvents.UPDATE_AVAILABLE, listener),
        onDownloadProgress: listener => subscribePayload(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, listener),
        onDownloadFinished: listener => subscribeVoid(RendererEvents.DOWNLOAD_UPDATE_FINISHED, listener),
        onDownloadFailed: listener => subscribeVoid(RendererEvents.DOWNLOAD_UPDATE_FAILED, listener),
    },
    settings: {
        getSnapshot: async () => ({
            settings: ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, 'settings') ?? {},
            mod: ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, 'mod') ?? {},
            app: ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, 'app') ?? {},
            addons: ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, 'addons') ?? {},
        }),
        updatePreferences: async patch => {
            applySettingsPatch(patch)
        },
        setLanguage: async language => {
            ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'settings.language', language)
        },
        resetModState: async () => {
            ipcRenderer.send(MainEvents.ELECTRON_STORE_DELETE, 'mod')
        },
    },
    auth: {
        getToken: async () => ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, 'tokens.token') ?? '',
        setToken: async token => ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'tokens.token', token),
        deleteToken: async () => ipcRenderer.send(MainEvents.ELECTRON_STORE_DELETE, 'tokens.token'),
        startBrowserAuth: () => ipcRenderer.invoke(MainEvents.START_BROWSER_AUTH),
        cancelBrowserAuth: () => ipcRenderer.invoke(MainEvents.CANCEL_BROWSER_AUTH),
        setStatus: payload => ipcRenderer.send(MainEvents.AUTH_STATUS, payload),
        sendPremiumToken: payload => ipcRenderer.send(MainEvents.SEND_PREMIUM_USER, payload),
        onSuccess: listener => subscribeVoid(RendererEvents.AUTH_SUCCESS, listener),
        onBanned: listener => subscribePayload(RendererEvents.AUTH_BANNED, listener),
        onPremiumTokenRequested: listener => subscribeVoid(RendererEvents.IS_PREMIUM_USER, listener),
    },
    system: {
        openExternal: request => ipcRenderer.send(MainEvents.OPEN_EXTERNAL, request.url),
        showNotification: request => ipcRenderer.send(MainEvents.SHOW_NOTIFICATION, request),
        getInfo: () => ipcRenderer.invoke(MainEvents.GET_SYSTEM_INFO),
        getSubcomponentsMeta: () => ipcRenderer.invoke(MainEvents.GET_SUBCOMPONENTS_META),
        createLogArchive: () => ipcRenderer.send(MainEvents.GET_LOG_ARCHIVE),
        startWebsocket: () => ipcRenderer.send(MainEvents.WEBSOCKET_START),
        openAppDirectory: () => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'appPath' }),
        openObsWidgetDirectory: () => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'obsWidgetPath' }),
        openApplicationsDirectory: () => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'openApplications' }),
        openPrivacySettings: () => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'privacySettings' }),
        openMarkdownText: markdownContent => ipcRenderer.send(MainEvents.OPEN_FILE, markdownContent),
        checkSleepMode: () => ipcRenderer.invoke(MainEvents.CHECK_SLEEP_MODE),
        onOpenModal: listener => subscribePayload(RendererEvents.OPEN_MODAL, listener),
        onMacPermissionsRequired: listener => subscribeVoid(RendererEvents.REQUEST_MAC_PERMISSIONS, listener),
        onShowModModal: listener => subscribeVoid(RendererEvents.SHOW_MOD_MODAL, listener),
    },
    logs: {
        rendererError: text => ipcRenderer.send(MainEvents.RENDERER_LOG, { error: true, text }),
        reactError: payload => ipcRenderer.send(MainEvents.LOG_ERROR, payload),
    },
    music: {
        getStatus: () => ipcRenderer.invoke(MainEvents.GET_MUSIC_STATUS),
        getRunningStatus: () => ipcRenderer.invoke(MainEvents.GET_MUSIC_RUNNING_STATUS),
        getVersion: () => ipcRenderer.invoke(MainEvents.GET_MUSIC_VERSION),
        checkInstall: () => ipcRenderer.send(MainEvents.CHECK_MUSIC_INSTALL),
        fixLinuxPermissions: () => ipcRenderer.invoke(MainEvents.FIX_LINUX_MUSIC_PERMISSIONS),
        selectLinuxAsarPath,
        refreshModInfo: () => ipcRenderer.send(MainEvents.REFRESH_MOD_INFO),
        requestTrackInfo: () => ipcRenderer.send(MainEvents.GET_TRACK_INFO),
        deleteYandexMusicApp: () => ipcRenderer.send(MainEvents.DELETE_YANDEX_MUSIC_APP),
        onClientReady: listener => subscribeVoid(RendererEvents.CLIENT_READY, listener),
        onYandexMusicUpdateRequired: listener => subscribeVoid(RendererEvents.SHOW_YANDEX_MUSIC_UPDATE_DIALOG, listener),
        onYandexMusicDeleteResult: listener =>
            subscribePayload(RendererEvents.DELETE_YANDEX_MUSIC_RESULT, payload => {
                const result = payload && typeof payload === 'object' ? payload : { success: false }
                listener(result as { success: boolean; message?: string })
            }),
        onTrackInfo: listener => subscribePayload(RendererEvents.TRACK_INFO, listener),
        onTrackPlayedEnough: listener => subscribePayload(RendererEvents.SEND_TRACK, listener),
    },
    mods: {
        getReleases: () => ipcRenderer.invoke(MainEvents.GET_MOD_RELEASES),
        install: request => ipcRenderer.send(MainEvents.INSTALL_MOD, request),
        remove: () => ipcRenderer.send(MainEvents.REMOVE_MOD),
        clearCache: () => ipcRenderer.send(MainEvents.CLEAR_MOD_CACHE),
        onUpdateCheckRequested: listener => subscribePayload(RendererEvents.CHECK_MOD_UPDATE, listener),
        onInstallStarted: listener => subscribePayload(RendererEvents.MOD_INSTALL_STARTED, listener),
        onDownloadProgress: listener => subscribePayload(RendererEvents.DOWNLOAD_PROGRESS, listener),
        onDownloadSuccess: listener => subscribePayload(RendererEvents.DOWNLOAD_SUCCESS, listener),
        onDownloadFailure: listener => subscribePayload(RendererEvents.DOWNLOAD_FAILURE, listener),
        onRemoveSuccess: listener => subscribePayload(RendererEvents.REMOVE_MOD_SUCCESS, listener),
        onRemoveFailure: listener => subscribePayload(RendererEvents.REMOVE_MOD_FAILURE, listener),
        onClearCacheSuccess: listener => subscribeVoid(RendererEvents.CLEAR_MOD_CACHE_SUCCESS, listener),
        onClearCacheFailure: listener => subscribePayload(RendererEvents.CLEAR_MOD_CACHE_FAILURE, listener),
    },
    addons: {
        list: () => ipcRenderer.invoke(MainEvents.GET_ADDONS),
        setEnabled: request => ipcRenderer.invoke(MainEvents.SET_ADDON_ENABLED, request),
        saveOrganization: async organization => {
            ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, 'addons.organization', organization)
        },
        importPext: filePath => ipcRenderer.invoke(MainEvents.IMPORT_PEXT_FILE, filePath),
        installStore: request => ipcRenderer.invoke(MainEvents.INSTALL_STORE_ADDON, request),
        packageArchive: request => ipcRenderer.invoke(MainEvents.PACKAGE_ADDON_ARCHIVE, request),
        exportArchive: request => ipcRenderer.invoke(MainEvents.EXPORT_ADDON, request),
        deleteDirectory: path => ipcRenderer.invoke(MainEvents.DELETE_ADDON_DIRECTORY, path),
        openDirectory: directoryName => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'theme', themeName: directoryName }),
        openRootDirectory: () => ipcRenderer.send(MainEvents.OPEN_PATH, { action: 'addonsPath' }),
        refreshClients: () => ipcRenderer.send(MainEvents.REFRESH_EXTENSIONS),
        createNew: () => ipcRenderer.invoke(MainEvents.CREATE_NEW_EXTENSION),
        files: {
            exists: targetPath => ipcRenderer.invoke(MainEvents.ADDON_FILE_EXISTS, targetPath),
            readText: (targetPath, encoding) => ipcRenderer.invoke(MainEvents.ADDON_FILE_READ_TEXT, targetPath, encoding),
            writeText: (targetPath, content) => ipcRenderer.invoke(MainEvents.ADDON_FILE_WRITE_TEXT, targetPath, content),
            readBase64: targetPath => ipcRenderer.invoke(MainEvents.ADDON_FILE_READ_BASE64, targetPath),
            writeBase64: (targetPath, base64) => ipcRenderer.invoke(MainEvents.ADDON_FILE_WRITE_BASE64, targetPath, base64),
            asDataUrl: targetPath => ipcRenderer.invoke(MainEvents.ADDON_FILE_AS_DATA_URL, targetPath),
            copyInto: request => ipcRenderer.invoke(MainEvents.ADDON_FILE_COPY_INTO, request),
            openDialog: request => ipcRenderer.invoke(MainEvents.ADDON_FILE_OPEN_DIALOG, request),
        },
        onOpenRequested: listener => subscribePayload(RendererEvents.OPEN_ADDON, listener),
    },
    widgets: {
        checkObsInstalled: () => ipcRenderer.invoke(MainEvents.CHECK_OBS_WIDGET_INSTALLED),
        downloadObs: () => ipcRenderer.send(MainEvents.DOWNLOAD_OBS_WIDGET),
        removeObs: () => ipcRenderer.send(MainEvents.REMOVE_OBS_WIDGET),
        getObsPath: () => ipcRenderer.invoke(MainEvents.GET_OBS_WIDGET_PATH),
        onDownloadProgress: listener => subscribePayload(RendererEvents.DOWNLOAD_OBS_WIDGET_PROGRESS, listener),
        onDownloadSuccess: listener => subscribeVoid(RendererEvents.DOWNLOAD_OBS_WIDGET_SUCCESS, listener),
        onDownloadFailure: listener => subscribePayload(RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, listener),
        onRemoveSuccess: listener => subscribeVoid(RendererEvents.REMOVE_OBS_WIDGET_SUCCESS, listener),
        onRemoveFailure: listener => subscribePayload(RendererEvents.REMOVE_OBS_WIDGET_FAILURE, listener),
    },
})

export const exposePulseSyncDesktop = (): void => {
    contextBridge.exposeInMainWorld('pulsesyncDesktop', createPulseSyncDesktopApi())
}
