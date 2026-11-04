import ElectronStoreModule from 'electron-store'

import { t } from '../shared/i18n'
import logger from '../shared/logger'
import { PULSESYNC_STORE_ENCRYPTION_KEY, PULSESYNC_STORE_NAME } from '../shared/storageIdentity'

const ElectronStore = ElectronStoreModule

let storeInstance: Store | undefined

export interface StoreType {
    get(key: string): any
    getAll(): Record<string, any>
    set(key: string, value: any): void
    delete(key: string): void
}

const schema = {
    settings: {
        type: 'object',
        description: t('main.storage.settings.description'),
        properties: {
            saveWindowDimensionsOnRestart: {
                type: 'boolean',
                description: t('main.storage.settings.saveWindowDimensionsOnRestart'),
                default: true,
            },
            saveWindowPositionOnRestart: {
                type: 'boolean',
                description: t('main.storage.settings.saveWindowPositionOnRestart'),
                default: true,
            },
            autoStartInTray: {
                type: 'boolean',
                description: t('main.storage.settings.autoStartInTray'),
                default: false,
            },
            openWindowOnManualLaunch: {
                type: 'boolean',
                description: t('main.storage.settings.openWindowOnManualLaunch'),
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
            autoUpdateStoreAddons: {
                type: 'boolean',
                description: 'Automatically update store addons when Yandex Music is closed',
                default: true,
            },
            closeAppInTray: {
                type: 'boolean',
                description: t('main.storage.settings.closeAppInTray'),
                default: false,
            },
            devSocket: {
                $comment: 'device-local',
                type: 'boolean',
                description: t('main.storage.settings.devSocket'),
                default: true,
            },
            showDevFrame: {
                $comment: 'device-local',
                type: 'boolean',
                description: 'Show the development build frame',
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
            storeReleaseChannel: {
                type: 'string',
                enum: ['stable', 'dev'],
                description: t('main.storage.settings.storeReleaseChannel'),
            },
            language: {
                type: 'string',
                description: t('main.storage.settings.language'),
                default: 'ru',
            },
            modSavePath: {
                $comment: 'device-local',
                type: 'string',
                description: t('main.storage.settings.modSavePath'),
                default: '',
            },
            modSource: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        enum: ['stable', 'branch'],
                        default: 'stable',
                    },
                    branch: {
                        type: 'string',
                        default: '',
                    },
                },
                required: ['type', 'branch'],
                additionalProperties: false,
                default: {
                    type: 'stable',
                    branch: '',
                },
            },
            windowDimensions: {
                $comment: 'device-local',
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
                $comment: 'device-local',
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
                $comment: 'device-local',
                type: 'number',
                description: t('main.storage.settings.lastDisplayId'),
                default: 0,
            },
            musicReinstalled: {
                $comment: 'device-local',
                type: 'boolean',
                description: t('main.storage.settings.musicReinstalled'),
                default: false,
            },
        },
        required: [
            'saveWindowDimensionsOnRestart',
            'saveWindowPositionOnRestart',
            'autoStartInTray',
            'openWindowOnManualLaunch',
            'autoStartMusic',
            'autoStartApp',
            'hardwareAcceleration',
            'deletePextAfterImport',
            'autoUpdateStoreAddons',
            'closeAppInTray',
            'devSocket',
            'showDevFrame',
            'askSavePath',
            'saveAsMp3',
            'showModModalAfterInstall',
            'language',
            'modSavePath',
            'modSource',
            'windowDimensions',
            'windowPosition',
            'lastDisplayId',
            'musicReinstalled',
        ],
        additionalProperties: true,
        default: {
            saveWindowDimensionsOnRestart: true,
            saveWindowPositionOnRestart: true,
            autoStartInTray: false,
            openWindowOnManualLaunch: false,
            autoStartMusic: false,
            autoStartApp: false,
            hardwareAcceleration: true,
            deletePextAfterImport: false,
            autoUpdateStoreAddons: true,
            closeAppInTray: false,
            devSocket: true,
            showDevFrame: true,
            askSavePath: false,
            saveAsMp3: false,
            showModModalAfterInstall: true,
            language: 'ru',
            modSavePath: '',
            modSource: {
                type: 'stable',
                branch: '',
            },
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
            sourceType: {
                type: 'string',
                enum: ['stable', 'branch'],
                default: 'stable',
            },
            branch: {
                type: 'string',
                default: '',
            },
            commit: {
                type: 'string',
                default: '',
            },
        },
        required: [
            'musicVersion',
            'name',
            'version',
            'realMusicVersion',
            'installed',
            'updated',
            'checksum',
            'unpackedChecksum',
            'sourceType',
            'branch',
            'commit',
        ],
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
            sourceType: 'stable',
            branch: '',
            commit: '',
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
        additionalProperties: true,
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

type PreferenceSchema = {
    type: string
    $comment?: string
    enum?: unknown[]
    properties?: Record<string, PreferenceSchema>
    required?: string[]
}

const pickPreferenceValue = (value: unknown, property: PreferenceSchema): unknown => {
    if (property.$comment === 'device-local' || value === undefined) return undefined
    if (property.enum && !property.enum.includes(value)) return undefined
    if (property.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || !property.properties) return undefined
        const entries = Object.entries(property.properties).flatMap(([key, child]) => {
            const picked = pickPreferenceValue((value as Record<string, unknown>)[key], child)
            return picked === undefined ? [] : [[key, picked]]
        })
        const result = Object.fromEntries(entries)
        return property.required?.some(key => !Object.hasOwn(result, key)) ? undefined : result
    }
    return typeof value === property.type && (typeof value !== 'number' || Number.isFinite(value)) ? value : undefined
}

export const pickCloudPreferences = (input: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
        Object.entries(schema.settings.properties).flatMap(([key, property]) => {
            const value = pickPreferenceValue(input[key], property)
            return value === undefined ? [] : [[key, value]]
        }),
    )

class Store implements StoreType {
    public store: any

    constructor() {
        try {
            this.store = new ElectronStore({
                name: PULSESYNC_STORE_NAME,
                encryptionKey: PULSESYNC_STORE_ENCRYPTION_KEY,
                schema,
                cache: true,
            })
            logger.main.info('Store initialized')
            this.store.delete('app.rendererSourceMode')
        } catch (error) {
            logger.main.error('Error initializing ElectronStore:', error)
        }
    }

    get(key: string): any {
        const value = this.store.get(key)
        // Cached objects are frozen; callers receive independent mutable snapshots.
        return value !== null && typeof value === 'object' ? structuredClone(value) : value
    }

    set(key: string, value: any): void {
        this.store.set(key, value)
    }

    delete(key: string): void {
        this.store.delete(key)
    }

    getAll() {
        return structuredClone(this.store.store)
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
