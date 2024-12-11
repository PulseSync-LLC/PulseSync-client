import SettingsInterface from '../interfaces/settings.interface'

const settingsInitials: SettingsInterface = {
    settings: {
        autoStartInTray: false,
        autoStartMusic: false,
        autoStartApp: false,
        closeAppInTray: false,
        writeMetadataAfterDownload: false,
    },
    info: {
        version: '',
    },
    patcher: {
        version: '',
        musicVersion: '',
        patched: false,
        updated: false,
        changelog: [],
    },
    tokens: {
        token: '',
    },
    discordRpc: {
        appId: '',
        enableRpcButtonListen: false,
        enableGithubButton: true,
        status: false,
        details: '',
        state: '',
        button: '',
    },
}

export default settingsInitials
