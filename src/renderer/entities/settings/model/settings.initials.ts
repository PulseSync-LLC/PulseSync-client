import SettingsInterface from '@entities/settings/model/settings.interface'

const settingsInitials: SettingsInterface = {
    settings: {
        autoStartInTray: false,
        saveWindowPositionOnRestart: false,
        saveWindowDimensionsOnRestart: false,
        autoStartMusic: false,
        autoStartApp: false,
        hardwareAcceleration: true,
        deletePextAfterImport: false,
        autoUpdateStoreAddons: true,
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
}

export default settingsInitials
