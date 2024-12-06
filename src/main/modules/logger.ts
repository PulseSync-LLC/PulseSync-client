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
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'log'),
            Pattern: 'yyy-mm-dd.log',
            AlwaysInCludePattern: true,
        },
        httpLog: {
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'http'),
            pattern: 'yyyy-MM-dd.log',
            KeepfileExt: true,
            alwaysIncludePattern: true,
        },
        errorsLog: {
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'errors'),
            pattern: 'yyyy-MM-dd.log',
            KeepfileExt: true,
            alwaysIncludePattern: true,
        },
        renderProcessLog: {
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'renderer'),
            pattern: 'yyyy-MM-dd.log',
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
        updaterLog: {
            type: 'dateFile',
            filename: path.join(LOG_PATH, 'updater'),
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            keepFileExt: true,
            MaxLogsize: 1024 * 1024 * 100,
            backups: 3,
        },
        crashLog: {
            type: 'file',
            filename: path.join(LOG_PATH, 'crash.log'),
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
        renderer: {
            appenders: ['out', 'renderProcessLog'],
            level: 'debug',
        },
        updater: {
            appenders: ['out', 'updaterLog'],
            level: 'debug',
        },
        crash: {
            appenders: ['out', 'crashLog'],
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
    updater: log4js.getLogger('updater'),
    renderer: log4js.getLogger('renderer'),
    crash: log4js.getLogger('crash'),
    discordRpc: log4js.getLogger('discordRpc'),
}
