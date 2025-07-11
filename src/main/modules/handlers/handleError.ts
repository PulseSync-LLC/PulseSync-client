import logger from '../logger'
import { app, crashReporter } from 'electron'
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
    process.on('uncaughtException', (error: Error) => {
        logger.main.error('Uncaught Exception:', toPlainError(error))
        HandleErrorsElectron.handleError('error_handler', error?.name, firstLine(error?.message), error)
        crashReporter.addExtraParameter('errorMessage', error.message)
        crashReporter.addExtraParameter('stack', error.stack || '')
        process.crash()
    })
    app.on('render-process-gone', (event, webContents, detailed) => {
        const REASON_CRASHED = 'crashed'
        const REASON_OOM = 'oom'
        HandleErrorsElectron.handleError('error_handler', 'render_process_gone', 'render_process_gone', detailed)
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
