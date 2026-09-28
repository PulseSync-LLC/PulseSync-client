import { app } from 'electron'

import { captureRendererTermination, flushErrorTracking } from '../errorTracking'
import logger from '../logger'
import { HandleErrorsElectron } from './handleErrorsElectron'

const firstLine = (message: string | Error) => {
    if (typeof message === 'string') {
        const [line] = message.split('\n')
        return line
    }
    return message.message.split('\n')[0]
}

export const toPlainError = (error: Error | any) => {
    if (error instanceof Error) {
        return `${error.name} ${firstLine(error.message)}`
    }
    return error
}

export const handleUncaughtException = () => {
    process.on('uncaughtException', async (error: Error) => {
        logger.main.error('Uncaught Exception:', toPlainError(error))
        HandleErrorsElectron.handleError('error_handler', 'uncaught_exception', error.name, error)
        await flushErrorTracking()
        process.exit(1)
    })

    process.on('unhandledRejection', reason => {
        const error = reason instanceof Error ? reason : new Error(String(reason))
        logger.main.error('Unhandled Rejection:', toPlainError(error))
        HandleErrorsElectron.handleError('error_handler', 'unhandled_rejection', error.name, error)
    })

    app.on('render-process-gone', (event, webContents, detailed) => {
        const REASON_CRASHED = 'crashed'
        const REASON_OOM = 'oom'
        captureRendererTermination(detailed)
        HandleErrorsElectron.handleError('error_handler', 'render_process_gone', 'render_process_gone', detailed, { capture: false })
        logger.renderer.error('Error in renderer: ' + detailed)
        if ([REASON_CRASHED, REASON_OOM].includes(detailed?.reason)) {
            if (detailed.reason === REASON_CRASHED) {
                logger.renderer.error('Crash renderer: ' + detailed)
                logger.renderer.info('Relaunching')
                app.relaunch()
            }
            logger.renderer.error('Error in renderer_oom: ' + detailed)
            app.exit(0)
        }
    })
}
