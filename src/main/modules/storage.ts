import { app, ipcMain } from 'electron'
import logger from './logger'
import ElectronStoreModule from 'electron-store'

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
        description: 'Настройки Discord Rich Presence',
        properties: {
            appId: {
                type: 'string',
                description: 'ID приложения Discord для Rich Presence',
                default: '',
            },
            status: {
                type: 'boolean',
                description: 'Включен ли статус Rich Presence',
                default: true,
            },
            details: {
                type: 'string',
                description: 'Текст деталей, отображаемый в Rich Presence',
                default: '',
            },
            state: {
                type: 'string',
                description: 'Текущее состояние для Rich Presence',
                default: '',
            },
            button: {
                type: 'string',
                description: 'Текст кнопки в Rich Presence (например, URL или действие)',
                default: '',
            },
            displayPause: {
                type: 'boolean',
                description: 'Показывать паузу в статусе, если воспроизведение на паузе',
                default: false,
            },
            showVersionOrDevice: {
                type: 'boolean',
                description: 'Показывать версию приложения или информацию об устройстве в статусе',
                default: false,
            },
            showTrackVersion: {
                type: 'boolean',
                description: 'Показывать версию трека в rpc',
                default: false,
            },
            showSmallIcon: {
                type: 'boolean',
                description: 'Использовать маленькую иконку для Rich Presence',
                default: false,
            },
            enableRpcButtonListen: {
                type: 'boolean',
                description: 'Включить прослушивание кликов по кнопке Rich Presence',
                default: true,
            },
            enableWebsiteButton: {
                type: 'boolean',
                description: 'Показывать кнопку Website в Rich Presence',
                default: true,
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
            'showSmallIcon',
            'enableRpcButtonListen',
            'enableWebsiteButton',
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
            showSmallIcon: false,
            enableRpcButtonListen: true,
            enableWebsiteButton: true,
        },
    },

    settings: {
        type: 'object',
        description: 'Основные флаги и параметры поведения приложения',
        properties: {
            saveWindowDimensionsOnRestart: {
                type: 'boolean',
                description: 'Сохранять размер окна при закрытии и восстанавливать при следующем запуске',
                default: false,
            },
            saveWindowPositionOnRestart: {
                type: 'boolean',
                description: 'Сохранять позицию окна при закрытии и восстанавливать при следующем запуске',
                default: false,
            },
            autoStartInTray: {
                type: 'boolean',
                description: 'Запускать приложение свернутым в трей при старте системы',
                default: false,
            },
            autoStartMusic: {
                type: 'boolean',
                description: 'Автоматически запускать воспроизведение музыки при старте приложения',
                default: false,
            },
            autoStartApp: {
                type: 'boolean',
                description: 'Автоматически запускать приложение при загрузке системы',
                default: false,
            },
            hardwareAcceleration: {
                type: 'boolean',
                description: 'Включить или отключить аппаратное ускорение (GPU) для приложения',
                default: true,
            },
            deletePextAfterImport: {
                type: 'boolean',
                description: 'Удалять временные файлы (Pext) после завершения импорта',
                default: false,
            },
            closeAppInTray: {
                type: 'boolean',
                description: 'При закрытии окна сворачивать приложение в трей, а не выходить полностью',
                default: false,
            },
            devSocket: {
                type: 'boolean',
                description: 'Включить режим разработчика: открывать сокет для отладки',
                default: true,
            },
            askSavePath: {
                type: 'boolean',
                description: 'Спрашивать путь для сохранения при выгрузке/экспорте',
                default: false,
            },
            saveAsMp3: {
                type: 'boolean',
                description: 'Сохранять треки или результаты в формате MP3 по умолчанию',
                default: false,
            },
            showModModalAfterInstall: {
                type: 'boolean',
                description: 'Показывать окно с информацией о моде после установки',
                default: false,
            },
            modSavePath: {
                type: 'string',
                description: 'Путь до мода',
                default: '',
            },
            windowDimensions: {
                type: 'object',
                description: 'Последние сохранённые размеры окна',
                properties: {
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
                additionalProperties: false,
                default: {},
            },
            windowPosition: {
                type: 'object',
                description: 'Последние сохранённые координаты окна',
                properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                },
                additionalProperties: false,
                default: {},
            },
            lastDisplayId: {
                type: 'number',
                description: 'ID последнего экрана, на котором было окно приложения',
                default: 0,
            },
            musicReinstalled: {
                type: 'boolean',
                description: 'Флаг, указывающий, переустановлена ли музыка',
                default: false,
            }
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
            showModModalAfterInstall: false,
            modSavePath: '',
            windowDimensions: {},
            windowPosition: {},
            lastDisplayId: 0,
            musicReinstalled: false,
        },
    },

    mod: {
        type: 'object',
        description: 'Информация и состояние мода',
        properties: {
            musicVersion: {
                type: 'string',
                description: 'Версия мода',
                default: '',
            },
            name: {
                type: 'string',
                description: 'Название мода',
                default: '',
            },
            version: {
                type: 'string',
                description: 'Версия мода',
                default: '',
            },
            installed: {
                type: 'boolean',
                description: 'Флаг, указывающий, установлен ли мод',
                default: false,
            },
            updated: {
                type: 'boolean',
                description: 'Флаг, указывающий, обновлен ли мод до последней версии',
                default: false,
            }
        },
        required: ['musicVersion', 'name', 'version', 'installed', 'updated'],
        additionalProperties: false,
        default: {
            musicVersion: '',
            name: '',
            version: '',
            installed: false,
            updated: false,
        },
    },

    tokens: {
        type: 'object',
        description: 'Токены для аутентификации',
        properties: {
            token: {
                type: 'string',
                description: 'Основной токен сессии',
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
