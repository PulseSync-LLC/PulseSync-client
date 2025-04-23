import log4js from 'log4js'
import path from 'path'
import { app } from 'electron'

const LOG_PATH = path.join(app.getPath('userData'), 'logs')

log4js.configure({
    appenders: {
        out: {
            type: 'console',
        },
        alldateFileLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'log.log'),
            AlwaysInCludePattern: true,
        },
        httpLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'http.log'),
            KeepfileExt: true,
            alwaysIncludePattern: true,
        },
        errorsLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'errors.log'),
            KeepfileExt: true,
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
            MaxLogsize: 1024 * 1024 * 100,
            backups: 3,
        },
        deeplinkManagerLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'deeplinkManager.log'),
            keepFileExt: true,
            MaxLogsize: 1024 * 1024 * 100,
            backups: 3,
        },
        updaterLog: {
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'updater'),
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            keepFileExt: true,
            MaxLogsize: 1024 * 1024 * 100,
            backups: 3,
        },
        debugLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'debug.log'),
        },
        discordRpc: {
            type: 'file',
            filename: path.join(LOG_PATH, 'discordRpc.log'),
        },
        error: {
            type: 'logLevelFilter',
            level: 'error',
            appender: 'errorLog',
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
        deeplinkManager: {
            appenders: ['out', 'deeplinkManagerLog'],
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
        debug: {
            appenders: ['out', 'debugLog'],
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
    deeplinkManager: log4js.getLogger('deeplinkManager'),
    updater: log4js.getLogger('updater'),
    renderer: log4js.getLogger('renderer'),
    debug: log4js.getLogger('debug'),
    discordRpc: log4js.getLogger('discordRpc'),
}
