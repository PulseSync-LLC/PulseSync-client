import log4js from 'log4js'
import path from 'path'
import { app } from 'electron'

const LOG_PATH = path.join(app.getPath('userData'), 'logs')

log4js.configure({
    appenders: {
        out: { type: 'console' },
        alldateFileLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'log.log'),
            alwaysIncludePattern: true,
        },
        httpLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'http.log'),
            keepFileExt: true,
            alwaysIncludePattern: true,
        },
        errorsLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'errors.log'),
            keepFileExt: true,
            alwaysIncludePattern: true,
        },
        renderProcessLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'renderer.log'),
            keepFileExt: true,
            alwaysIncludePattern: true,
        },
        mainProcessLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'main.log'),
            keepFileExt: true,
            maxLogSize: 1024 * 1024 * 20,
            backups: 3,
        },
        modManagerLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'modManager.log'),
            keepFileExt: true,
            maxLogSize: 1024 * 1024 * 20,
            backups: 3,
        },
        socketManagerLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'socketManager.log'),
            keepFileExt: true,
            maxLogSize: 1024 * 1024 * 20,
            backups: 3,
        },
        nativeModuleManagerLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'nativeModuleManager.log'),
            keepFileExt: true,
            maxLogSize: 1024 * 1024 * 20,
            backups: 3,
        },
        updaterLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'updaterManager.log'),
            keepFileExt: true,
            maxLogSize: 1024 * 1024 * 20,
            backups: 3,
        },
        discordRpc: {
            type: 'file',
            filename: path.join(LOG_PATH, 'discordRpc.log'),
        },
        error: {
            type: 'logLevelFilter',
            level: 'error',
            appender: 'errorsLog',
        },
    },
    categories: {
        date: {
            appenders: ['out', 'alldateFileLog'],
            level: 'debug',
        },
        http: {
            appenders: ['out', 'httpLog'],
            level: 'debug',
        },
        main: {
            appenders: ['out', 'mainProcessLog'],
            level: 'debug',
        },
        modManager: {
            appenders: ['out', 'modManagerLog'],
            level: 'debug',
        },
        socketManager: {
            appenders: ['out', 'socketManagerLog'],
            level: 'debug',
        },
        nativeModuleManager: {
            appenders: ['out', 'nativeModuleManagerLog'],
            level: 'debug',
        },
        renderer: {
            appenders: ['out', 'renderProcessLog'],
            level: 'debug',
        },
        updater: {
            appenders: ['out', 'updaterLog'],
            level: 'debug',
        },
        discordRpc: {
            appenders: ['out', 'discordRpc'],
            level: 'debug',
        },
        default: {
            appenders: ['out', 'alldateFileLog'],
            level: 'debug',
        },
    },
})
export default {
    default: log4js.getLogger('date'),
    http: log4js.getLogger('http'),
    main: log4js.getLogger('main'),
    modManager: log4js.getLogger('modManager'),
    socketManager: log4js.getLogger('socketManager'),
    nativeModuleManager: log4js.getLogger('nativeModuleManager'),
    updater: log4js.getLogger('updater'),
    renderer: log4js.getLogger('renderer'),
    discordRpc: log4js.getLogger('discordRpc'),
}
