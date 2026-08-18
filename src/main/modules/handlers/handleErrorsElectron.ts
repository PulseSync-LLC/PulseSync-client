import { app } from 'electron'

import fs from 'original-fs'
import path from 'path'

import { t } from '../../i18n'
import { captureMainException } from '../errorTracking'
import logger from '../logger'

const CRASH_FILE = path.join(app.getPath('appData'), 'PulseSync', 'logs', 'crash_app.log')

export class HandleErrorsElectron {
    public static handleError(
        className: string,
        method: string,
        block: string,
        error: unknown,
        options: { capture: boolean } = { capture: true },
    ): void {
        try {
            const errorObj = error instanceof Error ? error : new Error(String(error))
            const errorContext = `${className}/${method}/${block}:${errorObj.message}`
            const errorMessage = HandleErrorsElectron.formatLogMessage('ERROR', errorContext, errorObj.stack || errorObj.message)

            HandleErrorsElectron.storeCrash(errorMessage)
            if (options.capture) {
                captureMainException(errorObj, `${className}/${method}/${block}`)
            }
        } catch (internalError) {
            logger.main.error(t('main.handleErrors.internalError'), internalError)
        }
    }

    public static processStoredCrashes(): void {
        if (!fs.existsSync(CRASH_FILE)) return

        try {
            const crashData = fs.readFileSync(CRASH_FILE, 'utf-8')
            if (crashData.trim()) {
                fs.unlinkSync(CRASH_FILE)
                logger.main.error(`Stored crashes:\n${crashData}`)
            }
        } catch (error) {
            this.handleError('error_handler', 'process_stored_crashes', 'crash_file_handling', error)
        }
    }

    private static formatLogMessage(type: 'INFO' | 'ERROR', source: string, message: string): string {
        return `[${new Date().toISOString()}] [${type}] [${source}] ${message}`
    }

    private static storeCrash(errorMessage: string): void {
        try {
            fs.appendFileSync(CRASH_FILE, `${errorMessage}\n`)
        } catch (fsError) {
            logger.main.error(t('main.handleErrors.writeCrashLogError'), fsError)
        }
    }
}
