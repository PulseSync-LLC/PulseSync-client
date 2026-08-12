import type { PulseSyncDesktopApi } from '@common/desktopApi/contract'

function requireDesktopApi(): PulseSyncDesktopApi {
    const api = window.pulsesyncDesktop
    if (!api) {
        throw new Error('PulseSync desktop API is unavailable')
    }
    return api
}

export const desktopApi = {
    get apiVersion() {
        return requireDesktopApi().apiVersion
    },
    getRuntimeInfo() {
        return requireDesktopApi().getRuntimeInfo()
    },
    lifecycle: {
        ready: () => requireDesktopApi().lifecycle.ready(),
    },
    window: {
        minimize: () => requireDesktopApi().window.minimize(),
        maximize: () => requireDesktopApi().window.maximize(),
        close: (closeToTray: boolean) => requireDesktopApi().window.close(closeToTray),
        exit: () => requireDesktopApi().window.exit(),
        isMaximized: () => requireDesktopApi().window.isMaximized(),
        onMaximized: (listener: () => void) => requireDesktopApi().window.onMaximized(listener),
        onUnmaximized: (listener: () => void) => requireDesktopApi().window.onUnmaximized(listener),
    },
    updates: {
        start: () => requireDesktopApi().updates.start(),
        check: (request?: Parameters<PulseSyncDesktopApi['updates']['check']>[0]) => requireDesktopApi().updates.check(request),
        install: () => requireDesktopApi().updates.install(),
        getStatus: () => requireDesktopApi().updates.getStatus(),
        getBuildChannel: () => requireDesktopApi().updates.getBuildChannel(),
        getEffectiveChannel: () => requireDesktopApi().updates.getEffectiveChannel(),
        getChannelOverride: () => requireDesktopApi().updates.getChannelOverride(),
        setChannelOverride: (channel: string | null) => requireDesktopApi().updates.setChannelOverride(channel),
        getSource: () => requireDesktopApi().updates.getSource(),
        setSource: (source: string | null) => requireDesktopApi().updates.setSource(source),
        getClientChangelog: () => requireDesktopApi().updates.getClientChangelog(),
        getModChangelog: () => requireDesktopApi().updates.getModChangelog(),
        needModalUpdate: () => requireDesktopApi().updates.needModalUpdate(),
        onCheck: (listener: (payload: unknown) => void) => requireDesktopApi().updates.onCheck(listener),
        onAvailable: (listener: Parameters<PulseSyncDesktopApi['updates']['onAvailable']>[0]) => requireDesktopApi().updates.onAvailable(listener),
        onDownloadProgress: (listener: (progress: unknown) => void) => requireDesktopApi().updates.onDownloadProgress(listener),
        onDownloadFinished: (listener: () => void) => requireDesktopApi().updates.onDownloadFinished(listener),
        onDownloadFailed: (listener: () => void) => requireDesktopApi().updates.onDownloadFailed(listener),
    },
    settings: {
        getSnapshot: () => requireDesktopApi().settings.getSnapshot(),
        updatePreferences: (patch: Parameters<PulseSyncDesktopApi['settings']['updatePreferences']>[0]) =>
            requireDesktopApi().settings.updatePreferences(patch),
        setLanguage: (language: string) => requireDesktopApi().settings.setLanguage(language),
        resetModState: () => requireDesktopApi().settings.resetModState(),
    },
    auth: {
        getToken: () => requireDesktopApi().auth.getToken(),
        setToken: (token: string) => requireDesktopApi().auth.setToken(token),
        deleteToken: () => requireDesktopApi().auth.deleteToken(),
        startBrowserAuth: () => requireDesktopApi().auth.startBrowserAuth(),
        cancelBrowserAuth: () => requireDesktopApi().auth.cancelBrowserAuth(),
        setStatus: (payload: unknown) => requireDesktopApi().auth.setStatus(payload),
        sendPremiumToken: (payload: unknown) => requireDesktopApi().auth.sendPremiumToken(payload),
        onSuccess: (listener: () => void) => requireDesktopApi().auth.onSuccess(listener),
        onBanned: (listener: (payload: unknown) => void) => requireDesktopApi().auth.onBanned(listener),
        onPremiumTokenRequested: (listener: () => void) => requireDesktopApi().auth.onPremiumTokenRequested(listener),
    },
    system: {
        writeClipboardText: (text: string) => requireDesktopApi().system.writeClipboardText(text),
        openExternal: (url: string) => requireDesktopApi().system.openExternal({ url }),
        showNotification: (payload: Parameters<PulseSyncDesktopApi['system']['showNotification']>[0]) =>
            requireDesktopApi().system.showNotification(payload),
        getInfo: () => requireDesktopApi().system.getInfo(),
        getSubcomponentsMeta: () => requireDesktopApi().system.getSubcomponentsMeta(),
        createLogArchive: () => requireDesktopApi().system.createLogArchive(),
        startWebsocket: () => requireDesktopApi().system.startWebsocket(),
        openAppDirectory: () => requireDesktopApi().system.openAppDirectory(),
        openObsWidgetDirectory: () => requireDesktopApi().system.openObsWidgetDirectory(),
        openApplicationsDirectory: () => requireDesktopApi().system.openApplicationsDirectory(),
        openPrivacySettings: () => requireDesktopApi().system.openPrivacySettings(),
        openTextFile: (markdownContent: string) => requireDesktopApi().system.openMarkdownText(markdownContent),
        checkSleepMode: () => requireDesktopApi().system.checkSleepMode(),
        onOpenModal: (listener: (modalName: unknown) => void) => requireDesktopApi().system.onOpenModal(listener),
        onMacPermissionsRequired: (listener: () => void) => requireDesktopApi().system.onMacPermissionsRequired(listener),
        onShowModModal: (listener: () => void) => requireDesktopApi().system.onShowModModal(listener),
    },
    logs: {
        rendererError: (text: string) => requireDesktopApi().logs.rendererError(text),
        reactError: (payload: Parameters<PulseSyncDesktopApi['logs']['reactError']>[0]) => requireDesktopApi().logs.reactError(payload),
    },
    music: {
        getStatus: () => requireDesktopApi().music.getStatus(),
        getRunningStatus: () => requireDesktopApi().music.getRunningStatus(),
        getVersion: () => requireDesktopApi().music.getVersion(),
        checkInstall: () => requireDesktopApi().music.checkInstall(),
        fixLinuxPermissions: () => requireDesktopApi().music.fixLinuxPermissions(),
        selectLinuxAsarPath: (defaultPath?: string) => requireDesktopApi().music.selectLinuxAsarPath(defaultPath),
        refreshModInfo: () => requireDesktopApi().music.refreshModInfo(),
        requestTrackInfo: () => requireDesktopApi().music.requestTrackInfo(),
        deleteYandexMusicApp: () => requireDesktopApi().music.deleteYandexMusicApp(),
        onClientReady: (listener: () => void) => requireDesktopApi().music.onClientReady(listener),
        onYandexMusicUpdateRequired: (listener: () => void) => requireDesktopApi().music.onYandexMusicUpdateRequired(listener),
        onYandexMusicDeleteResult: (listener: Parameters<PulseSyncDesktopApi['music']['onYandexMusicDeleteResult']>[0]) =>
            requireDesktopApi().music.onYandexMusicDeleteResult(listener),
        onTrackInfo: (listener: (payload: unknown) => void) => requireDesktopApi().music.onTrackInfo(listener),
        onTrackPlayedEnough: (listener: (payload: unknown) => void) => requireDesktopApi().music.onTrackPlayedEnough(listener),
    },
    mods: {
        getReleases: () => requireDesktopApi().mods.getReleases(),
        install: (request: Parameters<PulseSyncDesktopApi['mods']['install']>[0]) => requireDesktopApi().mods.install(request),
        remove: () => requireDesktopApi().mods.remove(),
        clearCache: () => requireDesktopApi().mods.clearCache(),
        onUpdateCheckRequested: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onUpdateCheckRequested(listener),
        onInstallStarted: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onInstallStarted(listener),
        onDownloadProgress: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onDownloadProgress(listener),
        onDownloadSuccess: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onDownloadSuccess(listener),
        onDownloadFailure: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onDownloadFailure(listener),
        onRemoveSuccess: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onRemoveSuccess(listener),
        onRemoveFailure: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onRemoveFailure(listener),
        onClearCacheSuccess: (listener: () => void) => requireDesktopApi().mods.onClearCacheSuccess(listener),
        onClearCacheFailure: (listener: (payload: unknown) => void) => requireDesktopApi().mods.onClearCacheFailure(listener),
    },
    addons: {
        list: () => requireDesktopApi().addons.list(),
        setEnabled: (request: Parameters<PulseSyncDesktopApi['addons']['setEnabled']>[0]) => requireDesktopApi().addons.setEnabled(request),
        saveOrganization: (organization: Parameters<PulseSyncDesktopApi['addons']['saveOrganization']>[0]) =>
            requireDesktopApi().addons.saveOrganization(organization),
        importPext: (path: string) => requireDesktopApi().addons.importPext(path),
        installStore: (request: Parameters<PulseSyncDesktopApi['addons']['installStore']>[0]) => requireDesktopApi().addons.installStore(request),
        packageArchive: (request: Parameters<PulseSyncDesktopApi['addons']['packageArchive']>[0]) =>
            requireDesktopApi().addons.packageArchive(request),
        exportArchive: (request: Parameters<PulseSyncDesktopApi['addons']['exportArchive']>[0]) => requireDesktopApi().addons.exportArchive(request),
        deleteDirectory: (path: string) => requireDesktopApi().addons.deleteDirectory(path),
        openDirectory: (directoryName: string) => requireDesktopApi().addons.openDirectory(directoryName),
        openRootDirectory: () => requireDesktopApi().addons.openRootDirectory(),
        refreshClients: () => requireDesktopApi().addons.refreshClients(),
        createNew: () => requireDesktopApi().addons.createNew(),
        files: {
            exists: (path: string) => requireDesktopApi().addons.files.exists(path),
            readText: (path: string, encoding?: string) => requireDesktopApi().addons.files.readText(path, encoding),
            writeText: (path: string, content: string) => requireDesktopApi().addons.files.writeText(path, content),
            readBase64: (path: string) => requireDesktopApi().addons.files.readBase64(path),
            writeBase64: (path: string, base64: string) => requireDesktopApi().addons.files.writeBase64(path, base64),
            asDataUrl: (path: string) => requireDesktopApi().addons.files.asDataUrl(path),
            copyInto: (request: Parameters<PulseSyncDesktopApi['addons']['files']['copyInto']>[0]) =>
                requireDesktopApi().addons.files.copyInto(request),
            openDialog: (request?: Parameters<PulseSyncDesktopApi['addons']['files']['openDialog']>[0]) =>
                requireDesktopApi().addons.files.openDialog(request),
        },
        onOpenRequested: (listener: (payload: unknown) => void) => requireDesktopApi().addons.onOpenRequested(listener),
    },
    widgets: {
        checkObsInstalled: () => requireDesktopApi().widgets.checkObsInstalled(),
        downloadObs: () => requireDesktopApi().widgets.downloadObs(),
        removeObs: () => requireDesktopApi().widgets.removeObs(),
        getObsPath: () => requireDesktopApi().widgets.getObsPath(),
        onDownloadProgress: (listener: (payload: unknown) => void) => requireDesktopApi().widgets.onDownloadProgress(listener),
        onDownloadSuccess: (listener: () => void) => requireDesktopApi().widgets.onDownloadSuccess(listener),
        onDownloadFailure: (listener: (payload: unknown) => void) => requireDesktopApi().widgets.onDownloadFailure(listener),
        onRemoveSuccess: (listener: () => void) => requireDesktopApi().widgets.onRemoveSuccess(listener),
        onRemoveFailure: (listener: (payload: unknown) => void) => requireDesktopApi().widgets.onRemoveFailure(listener),
    },
}
