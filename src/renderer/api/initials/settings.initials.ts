import SettingsInterface from '../interfaces/settings.interface'

const settingsInitials: SettingsInterface = {
    settings: {
        autoStartInTray: false,
        saveWindowPositionOnRestart: false,
        saveWindowDimensionsOnRestart: false,
        autoStartMusic: false,
        autoStartApp: false,
        hardwareAcceleration: true,
        deletePextAfterImport: false,
        closeAppInTray: false,
        askSavePath: false,
        saveAsMp3: false,
        devSocket: false,
        showModModalAfterInstall: true,
        language: 'ru',
    },
    info: {
        version: '',
    },
    mod: {
        version: '',
        name: '',
        musicVersion: '',
        installed: false,
        showModal: true,
        updated: false,
        changelog: [],
    },
    tokens: {
        token: '',
    },
    discordRpc: {
        appId: '',
        displayPause: false,
        enableRpcButtonListen: false,
        enableWebsiteButton: true,
        enableDeepLink: false,
        showVersionOrDevice: false,
        showSmallIcon: true,
        showTrackVersion: false,
        supporterHideBranding: false,
        statusLanguage: 'en',
        statusDisplayType: 1,
        status: true,
        details: '',
        state: '',
        button: '',
    },
}

export default settingsInitials
