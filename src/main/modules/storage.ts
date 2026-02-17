import { app, ipcMain } from 'electron'
import logger from './logger'
import ElectronStoreModule from 'electron-store'
import { t } from '../i18n'

const ElectronStore = ElectronStoreModule

let storeInstance: any

export interface StoreType {
    getAll(): Record<string, any>
    set(key: string, value: any): void
    delete(key: string): void
}

const schema = {
    discordRpc: {
        type: 'object',
        description: t('main.storage.discordRpc.description'),
        properties: {
            appId: {
                type: 'string',
                description: t('main.storage.discordRpc.appId'),
                default: '',
            },
            status: {
                type: 'boolean',
                description: t('main.storage.discordRpc.status'),
                default: true,
            },
            details: {
                type: 'string',
                description: t('main.storage.discordRpc.details'),
                default: '',
            },
            state: {
                type: 'string',
                description: t('main.storage.discordRpc.state'),
                default: '',
            },
            button: {
                type: 'string',
                description: t('main.storage.discordRpc.button'),
                default: '',
            },
            displayPause: {
                type: 'boolean',
                description: t('main.storage.discordRpc.displayPause'),
                default: false,
            },
            showVersionOrDevice: {
                type: 'boolean',
                description: t('main.storage.discordRpc.showVersionOrDevice'),
                default: false,
            },
            showTrackVersion: {
                type: 'boolean',
                description: t('main.storage.discordRpc.showTrackVersion'),
                default: false,
            },
            supporterHideBranding: {
                type: 'boolean',
                description: t('main.storage.discordRpc.supporterHideBranding'),
                default: false,
            },
            showSmallIcon: {
                type: 'boolean',
                description: t('main.storage.discordRpc.showSmallIcon'),
                default: false,
            },
            enableRpcButtonListen: {
                type: 'boolean',
                description: t('main.storage.discordRpc.enableRpcButtonListen'),
                default: true,
            },
            enableWebsiteButton: {
                type: 'boolean',
                description: t('main.storage.discordRpc.enableWebsiteButton'),
                default: true,
            },
            statusDisplayType: {
                type: 'number',
                description: t('main.storage.discordRpc.statusDisplayType'),
                default: 1,
            },
            statusLanguage: {
                type: 'string',
                description: t('main.storage.discordRpc.statusLanguage'),
                default: 'en',
            },
            lockedByDrpcV2: {
                type: 'boolean',
                description: t('main.storage.discordRpc.lockedByDrpcV2'),
                default: false,
            },
        },
        required: [
            'appId',
            'status',
            'details',
            'state',
            'button',
            'displayPause',
            'showVersionOrDevice',
            'showTrackVersion',
            'supporterHideBranding',
            'showSmallIcon',
            'enableRpcButtonListen',
            'enableWebsiteButton',
            'statusDisplayType',
            'statusLanguage',
            'lockedByDrpcV2',
        ],
        additionalProperties: true,
        default: {
            appId: '',
            status: true,
            details: '',
            state: '',
            button: '',
            displayPause: false,
            showVersionOrDevice: false,
            showTrackVersion: false,
            supporterHideBranding: false,
            showSmallIcon: false,
            enableRpcButtonListen: true,
            enableWebsiteButton: true,
            statusDisplayType: 1,
            statusLanguage: 'en',
            lockedByDrpcV2: false,
        },
    },

    settings: {
        type: 'object',
        description: t('main.storage.settings.description'),
        properties: {
            saveWindowDimensionsOnRestart: {
                type: 'boolean',
                description: t('main.storage.settings.saveWindowDimensionsOnRestart'),
                default: false,
            },
            saveWindowPositionOnRestart: {
                type: 'boolean',
                description: t('main.storage.settings.saveWindowPositionOnRestart'),
                default: false,
            },
            autoStartInTray: {
                type: 'boolean',
                description: t('main.storage.settings.autoStartInTray'),
                default: false,
            },
            autoStartMusic: {
                type: 'boolean',
                description: t('main.storage.settings.autoStartMusic'),
                default: false,
            },
            autoStartApp: {
                type: 'boolean',
                description: t('main.storage.settings.autoStartApp'),
                default: false,
            },
            hardwareAcceleration: {
                type: 'boolean',
                description: t('main.storage.settings.hardwareAcceleration'),
                default: true,
            },
            deletePextAfterImport: {
                type: 'boolean',
                description: t('main.storage.settings.deletePextAfterImport'),
                default: false,
            },
            closeAppInTray: {
                type: 'boolean',
                description: t('main.storage.settings.closeAppInTray'),
                default: false,
            },
            devSocket: {
                type: 'boolean',
                description: t('main.storage.settings.devSocket'),
                default: true,
            },
            askSavePath: {
                type: 'boolean',
                description: t('main.storage.settings.askSavePath'),
                default: false,
            },
            saveAsMp3: {
                type: 'boolean',
                description: t('main.storage.settings.saveAsMp3'),
                default: false,
            },
            showModModalAfterInstall: {
                type: 'boolean',
                description: t('main.storage.settings.showModModalAfterInstall'),
                default: false,
            },
            language: {
                type: 'string',
                description: t('main.storage.settings.language'),
                default: 'ru',
            },
            modSavePath: {
                type: 'string',
                description: t('main.storage.settings.modSavePath'),
                default: '',
            },
            windowDimensions: {
                type: 'object',
                description: t('main.storage.settings.windowDimensions'),
                properties: {
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
                additionalProperties: false,
                default: {},
            },
            windowPosition: {
                type: 'object',
                description: t('main.storage.settings.windowPosition'),
                properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                },
                additionalProperties: false,
                default: {},
            },
            lastDisplayId: {
                type: 'number',
                description: t('main.storage.settings.lastDisplayId'),
                default: 0,
            },
            musicReinstalled: {
                type: 'boolean',
                description: t('main.storage.settings.musicReinstalled'),
                default: false,
            },
        },
        required: [
            'saveWindowDimensionsOnRestart',
            'saveWindowPositionOnRestart',
            'autoStartInTray',
            'autoStartMusic',
            'autoStartApp',
            'hardwareAcceleration',
            'deletePextAfterImport',
            'closeAppInTray',
            'devSocket',
            'askSavePath',
            'saveAsMp3',
            'showModModalAfterInstall',
            'language',
            'modSavePath',
            'windowDimensions',
            'windowPosition',
            'lastDisplayId',
            'musicReinstalled',
        ],
        additionalProperties: true,
        default: {
            saveWindowDimensionsOnRestart: false,
            saveWindowPositionOnRestart: false,
            autoStartInTray: false,
            autoStartMusic: false,
            autoStartApp: false,
            hardwareAcceleration: true,
            deletePextAfterImport: false,
            closeAppInTray: false,
            devSocket: true,
            askSavePath: false,
            saveAsMp3: false,
            showModModalAfterInstall: true,
            language: 'ru',
            modSavePath: '',
            windowDimensions: {},
            windowPosition: {},
            lastDisplayId: 0,
            musicReinstalled: false,
        },
    },

    mod: {
        type: 'object',
        description: t('main.storage.mod.description'),
        properties: {
            musicVersion: {
                type: 'string',
                description: t('main.storage.mod.musicVersion'),
                default: '',
            },
            name: {
                type: 'string',
                description: t('main.storage.mod.name'),
                default: '',
            },
            version: {
                type: 'string',
                description: t('main.storage.mod.version'),
                default: '',
            },
            realMusicVersion: {
                type: 'string',
                description: t('main.storage.mod.realMusicVersion'),
                default: '',
            },
            installed: {
                type: 'boolean',
                description: t('main.storage.mod.installed'),
                default: false,
            },
            updated: {
                type: 'boolean',
                description: t('main.storage.mod.updated'),
                default: false,
            },
            checksum: {
                type: 'string',
                description: t('main.storage.mod.checksum'),
                default: '',
            },
            unpackedChecksum: {
                type: 'string',
                description: t('main.storage.mod.unpackedChecksum'),
                default: '',
            },
        },
        required: ['musicVersion', 'name', 'version', 'realMusicVersion', 'installed', 'updated', 'checksum', 'unpackedChecksum'],
        additionalProperties: false,
        default: {
            musicVersion: '',
            realMusicVersion: '',
            name: '',
            version: '',
            installed: false,
            updated: false,
            checksum: '',
            unpackedChecksum: '',
        },
    },

    app: {
        type: 'object',
        description: t('main.storage.app.description'),
        properties: {
            version: {
                type: 'string',
                description: t('main.storage.app.version'),
                default: '',
            },
        },
        required: ['version'],
        additionalProperties: false,
        default: {
            version: '',
        },
    },

    tokens: {
        type: 'object',
        description: t('main.storage.tokens.description'),
        properties: {
            token: {
                type: 'string',
                description: t('main.storage.tokens.token'),
                default: '',
            },
        },
        required: ['token'],
        additionalProperties: false,
        default: {
            token: '',
        },
    },
}

class Store {
    public store: any

    constructor() {
        try {
            this.store = new ElectronStore({
                name: 'pulsesync_settings',
                encryptionKey: 'pulsesync',
                schema,
            })
            logger.main.info('Store initialized')
        } catch (error) {
            logger.main.error('Error initializing ElectronStore:', error)
        }

        if (!this.store.get('settings.hardwareAcceleration', true)) {
            app.disableHardwareAcceleration()
        }
    }

    get(key: string): any {
        return this.store.get(key)
    }

    set(key: string, value: any): void {
        this.store.set(key, value)
    }

    delete(key: string): void {
        this.store.delete(key)
    }

    getAll() {
        return this.store.store
    }
}

export const getStore = (() => {
    return () => {
        if (!storeInstance) {
            storeInstance = new Store()
        }
        return storeInstance
    }
})()
