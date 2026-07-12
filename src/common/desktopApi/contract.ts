import type { ClientBuildIdentity } from '../types/clientBuildIdentity'
import type { ClientHardwareIdentity } from '../types/clientHardwareIdentity'
export { DESKTOP_API_VERSION } from './version'

export interface DesktopRuntimeInfo {
    apiVersion: string
    hostVersion: string
    coreVersion: string
    buildChannel: string | null
    platform: NodeJS.Platform
    isDev: boolean
    isLinux: boolean
    isMac: boolean
    buildIdentity: ClientBuildIdentity
    hardwareIdentity: ClientHardwareIdentity | null
}

export interface DesktopStateSnapshot {
    settings: Record<string, unknown>
    mod: Record<string, unknown>
    app: Record<string, unknown>
    addons: Record<string, unknown>
}

export interface DesktopSettingsPatch {
    autoStartInTray?: boolean
    autoStartMusic?: boolean
    autoStartApp?: boolean
    hardwareAcceleration?: boolean
    deletePextAfterImport?: boolean
    autoUpdateStoreAddons?: boolean
    closeAppInTray?: boolean
    devSocket?: boolean
    askSavePath?: boolean
    saveAsMp3?: boolean
    showModModalAfterInstall?: boolean
    saveWindowPositionOnRestart?: boolean
    saveWindowDimensionsOnRestart?: boolean
    modSavePath?: string
}

export interface DesktopNotificationRequest {
    title: string
    body: string
}

export interface DesktopCheckUpdateRequest {
    hard?: boolean
    manual?: boolean
}

export interface DesktopUpdateAvailablePayload {
    kind: 'client' | 'renderer'
    version: string
}

export interface DesktopInstallModRequest {
    version: string
    musicVersion?: string
    name: string
    link: string
    unpackLink?: string
    unpackedChecksum?: string
    checksum?: string
    shouldReinstall?: boolean
    source?: 'backend' | 'github'
}

export interface DesktopInstallStoreAddonRequest {
    id?: string
    downloadUrl?: string
    title?: string
}

export interface DesktopPackageAddonArchiveRequest {
    name?: string
    path?: string
}

export interface DesktopExportAddonRequest {
    name?: string
    path?: string
}

export interface DesktopSetAddonEnabledRequest {
    directoryName?: string
    enabled?: boolean
}

export interface DesktopAddonFileDialogFilter {
    name: string
    extensions: string[]
}

export interface DesktopAddonFileDialogRequest {
    defaultPath?: string
    filters?: DesktopAddonFileDialogFilter[]
    metadata?: boolean
}

export interface DesktopAddonFileWriteResult {
    error?: string
    success: boolean
}

export interface DesktopAddonFileCopyIntoRequest {
    addonPath: string
    existingRelativePath?: string
    preferredName?: string
    sourcePath: string
}

export interface DesktopAddonFileCopyIntoResult {
    error?: string
    relativePath?: string
    success: boolean
}

export interface DesktopOpenExternalRequest {
    url: string
}

export interface DesktopReactErrorPayload {
    type: 'react-error-boundary'
    message: string
    stack?: string
    componentStack?: string | null
}

export interface DesktopYandexMusicDeleteResult {
    success: boolean
    message?: string
}

export interface DesktopSelectLinuxAsarPathResult {
    canceled: boolean
    path: string | null
}

export type DesktopUnsubscribe = () => void

export interface PulseSyncDesktopApi {
    readonly apiVersion: string
    getRuntimeInfo(): Promise<DesktopRuntimeInfo>
    lifecycle: {
        ready(): void
    }
    window: {
        minimize(): void
        maximize(): void
        close(closeToTray: boolean): void
        exit(): void
        isMaximized(): Promise<boolean>
        onMaximized(listener: () => void): DesktopUnsubscribe
        onUnmaximized(listener: () => void): DesktopUnsubscribe
    }
    updates: {
        start(): void
        check(request?: DesktopCheckUpdateRequest): void
        install(): void
        getStatus(): Promise<string>
        getBuildChannel(): Promise<string>
        getEffectiveChannel(): Promise<string>
        getChannelOverride(): Promise<string | null>
        setChannelOverride(channel: string | null): Promise<unknown>
        getSource(): Promise<string>
        setSource(source: string | null): Promise<unknown>
        getClientChangelog(): Promise<unknown>
        getModChangelog(): Promise<unknown>
        needModalUpdate(): Promise<boolean>
        onCheck(listener: (payload: unknown) => void): DesktopUnsubscribe
        onAvailable(listener: (payload: DesktopUpdateAvailablePayload) => void): DesktopUnsubscribe
        onDownloadProgress(listener: (progress: unknown) => void): DesktopUnsubscribe
        onDownloadFinished(listener: () => void): DesktopUnsubscribe
        onDownloadFailed(listener: () => void): DesktopUnsubscribe
    }
    settings: {
        getSnapshot(): Promise<DesktopStateSnapshot>
        updatePreferences(patch: DesktopSettingsPatch): Promise<void>
        setLanguage(language: string): Promise<void>
        resetModState(): Promise<void>
    }
    auth: {
        getToken(): Promise<string>
        setToken(token: string): Promise<void>
        deleteToken(): Promise<void>
        startBrowserAuth(): Promise<unknown>
        cancelBrowserAuth(): Promise<unknown>
        setStatus(payload: unknown): void
        sendPremiumToken(payload: unknown): void
        onSuccess(listener: () => void): DesktopUnsubscribe
        onBanned(listener: (payload: unknown) => void): DesktopUnsubscribe
        onPremiumTokenRequested(listener: () => void): DesktopUnsubscribe
    }
    system: {
        openExternal(request: DesktopOpenExternalRequest): void
        showNotification(request: DesktopNotificationRequest): void
        getInfo(): Promise<unknown>
        getSubcomponentsMeta(): Promise<unknown>
        createLogArchive(): void
        startWebsocket(): void
        openAppDirectory(): void
        openObsWidgetDirectory(): void
        openApplicationsDirectory(): void
        openPrivacySettings(): void
        openMarkdownText(markdownContent: string): void
        checkSleepMode(): Promise<boolean>
        onOpenModal(listener: (modalName: unknown) => void): DesktopUnsubscribe
        onMacPermissionsRequired(listener: () => void): DesktopUnsubscribe
        onShowModModal(listener: () => void): DesktopUnsubscribe
    }
    logs: {
        rendererError(text: string): void
        reactError(payload: DesktopReactErrorPayload): void
    }
    music: {
        getStatus(): Promise<boolean>
        getRunningStatus(): Promise<boolean>
        getVersion(): Promise<string | undefined>
        checkInstall(): void
        fixLinuxPermissions(): Promise<unknown>
        selectLinuxAsarPath(defaultPath?: string): Promise<DesktopSelectLinuxAsarPathResult>
        refreshModInfo(): void
        requestTrackInfo(): void
        deleteYandexMusicApp(): void
        onClientReady(listener: () => void): DesktopUnsubscribe
        onYandexMusicUpdateRequired(listener: () => void): DesktopUnsubscribe
        onYandexMusicDeleteResult(listener: (payload: DesktopYandexMusicDeleteResult) => void): DesktopUnsubscribe
        onTrackInfo(listener: (payload: unknown) => void): DesktopUnsubscribe
        onTrackPlayedEnough(listener: (payload: unknown) => void): DesktopUnsubscribe
    }
    mods: {
        getReleases(): Promise<unknown>
        install(request: DesktopInstallModRequest): void
        remove(): void
        clearCache(): void
        onUpdateCheckRequested(listener: (payload: unknown) => void): DesktopUnsubscribe
        onInstallStarted(listener: (payload: unknown) => void): DesktopUnsubscribe
        onDownloadProgress(listener: (payload: unknown) => void): DesktopUnsubscribe
        onDownloadSuccess(listener: (payload: unknown) => void): DesktopUnsubscribe
        onDownloadFailure(listener: (payload: unknown) => void): DesktopUnsubscribe
        onRemoveSuccess(listener: (payload: unknown) => void): DesktopUnsubscribe
        onRemoveFailure(listener: (payload: unknown) => void): DesktopUnsubscribe
        onClearCacheSuccess(listener: () => void): DesktopUnsubscribe
        onClearCacheFailure(listener: (payload: unknown) => void): DesktopUnsubscribe
    }
    addons: {
        list(): Promise<unknown>
        setEnabled(request: DesktopSetAddonEnabledRequest): Promise<unknown>
        importPext(path: string): Promise<unknown>
        installStore(request: DesktopInstallStoreAddonRequest): Promise<unknown>
        packageArchive(request: DesktopPackageAddonArchiveRequest): Promise<unknown>
        exportArchive(request: DesktopExportAddonRequest): Promise<unknown>
        deleteDirectory(path: string): Promise<unknown>
        openDirectory(directoryName: string): void
        openRootDirectory(): void
        refreshClients(): void
        createNew(): Promise<unknown>
        files: {
            exists(path: string): Promise<boolean>
            readText(path: string, encoding?: string): Promise<string | null>
            writeText(path: string, content: string): Promise<DesktopAddonFileWriteResult>
            readBase64(path: string): Promise<string | null>
            writeBase64(path: string, base64: string): Promise<boolean>
            asDataUrl(path: string): Promise<string | null>
            copyInto(request: DesktopAddonFileCopyIntoRequest): Promise<DesktopAddonFileCopyIntoResult>
            openDialog(request?: DesktopAddonFileDialogRequest): Promise<string | null>
        }
        onOpenRequested(listener: (payload: unknown) => void): DesktopUnsubscribe
    }
    widgets: {
        checkObsInstalled(): Promise<boolean>
        downloadObs(): void
        removeObs(): void
        getObsPath(): Promise<string | null>
        onDownloadProgress(listener: (payload: unknown) => void): DesktopUnsubscribe
        onDownloadSuccess(listener: () => void): DesktopUnsubscribe
        onDownloadFailure(listener: (payload: unknown) => void): DesktopUnsubscribe
        onRemoveSuccess(listener: () => void): DesktopUnsubscribe
        onRemoveFailure(listener: (payload: unknown) => void): DesktopUnsubscribe
    }
}
