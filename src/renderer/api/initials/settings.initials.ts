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
        enableGithubButton: true,
        showVersionOrDevice: false,
        showSmallIcon: true,
        status: true,
        details: '',
        state: '',
        button: '',
    },
}

export default settingsInitials
