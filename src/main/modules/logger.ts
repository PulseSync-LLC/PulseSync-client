import { app } from 'electron'

import log4js from 'log4js'
import path from 'path'

const LOG_PATH = path.join(app.getPath('userData'), 'logs')
const includeConsoleAppender = !process.env.PULSESYNC_LAUNCH_RESERVATION_ID
const categoryAppenders = (...appenders: string[]): string[] => (includeConsoleAppender ? ['out', ...appenders] : appenders)

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
        error: {
            type: 'logLevelFilter',
            level: 'error',
            appender: 'errorsLog',
        },
    },
    categories: {
        date: {
            appenders: categoryAppenders('alldateFileLog'),
            level: 'debug',
        },
        http: {
            appenders: categoryAppenders('httpLog'),
            level: 'debug',
        },
        main: {
            appenders: categoryAppenders('mainProcessLog'),
            level: 'debug',
        },
        modManager: {
            appenders: categoryAppenders('modManagerLog'),
            level: 'debug',
        },
        socketManager: {
            appenders: categoryAppenders('socketManagerLog'),
            level: 'debug',
        },
        nativeModuleManager: {
            appenders: categoryAppenders('nativeModuleManagerLog'),
            level: 'debug',
        },
        renderer: {
            appenders: categoryAppenders('renderProcessLog'),
            level: 'debug',
        },
        updater: {
            appenders: categoryAppenders('updaterLog'),
            level: 'debug',
        },
        default: {
            appenders: categoryAppenders('alldateFileLog'),
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
}
