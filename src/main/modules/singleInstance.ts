import { app, BrowserWindow } from 'electron'
import { checkIsDeeplink, navigateToDeeplink } from './handlers/handleDeepLink'
import logger from './logger'
import { mainWindow, prestartCheck } from '../../index'
import { handleUncaughtException } from './handlers/handleError'
import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'fs'
import { store } from './storage'
import { HandleErrorsElectron } from './handlers/handleErrorsElectron'
import { authorized } from '../events'

export const isFirstInstance = app.requestSingleInstanceLock()

export const checkForSingleInstance = async (): Promise<void> => {
    logger.main.info('Single instance')
    if (isFirstInstance) {
        const [window] = BrowserWindow.getAllWindows()

        if (process.platform === 'darwin') {
            app.on('open-url', (event, url) => {
                event.preventDefault()
                logger.main.info(`open-url event: ${url}`)
                if (window && checkIsDeeplink(url)) {
                    navigateToDeeplink(window, url)
                }
            })

            app.on('open-file', (event, filePath) => {
                event.preventDefault()
                logger.main.info(`open-file event: ${filePath}`)
                if (filePath.toLowerCase().endsWith('.pext')) {
                    handlePextFile(filePath)
                }
            })
        }

        app.on('second-instance', async (event: Electron.Event, commandLine: string[]) => {
            if (window) {
                if (window.isMinimized()) {
                    window.restore()
                    logger.main.info('Restore window')
                }
                const lastCommandLineArg = commandLine.pop()
                if (lastCommandLineArg) {
                    if (checkIsDeeplink(lastCommandLineArg)) {
                        navigateToDeeplink(window, lastCommandLineArg)
                    } else if (lastCommandLineArg.toLowerCase().endsWith('.pext')) {
                        await handlePextFile(lastCommandLineArg)
                    }
                }
                toggleWindowVisibility(window, true)
                logger.main.info('Show window')
            }
        })
        await prestartCheck()
        handleUncaughtException()
    } else {
        app.quit()
    }
}

const toggleWindowVisibility = (window: BrowserWindow, isVisible: boolean) => {
    if (isVisible) {
        window.show()
    } else {
        window.hide()
    }
}

async function handlePextFile(filePath: string) {
    const zip = new AdmZip(filePath)
    const tempDir = path.join(app.getPath('temp'), `pext-import-${Date.now()}`)
    fs.mkdirSync(tempDir)

    zip.extractAllTo(tempDir, true)

    const metadataPath = path.join(tempDir, 'metadata.json')
    if (!fs.existsSync(metadataPath)) {
        logger.main.error('Missing metadata.json')
        return
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    const addonName = metadata.name
    if (!addonName) {
        logger.main.error('Theme name missing in metadata.json')
        return
    }

    const outputDir = path.join(app.getPath('userData'), 'addons', addonName)
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }
    zip.extractAllTo(outputDir, true)

    logger.main.info(`Extension exported successfully to ${outputDir}`)

    if (store.get('settings.deletePextAfterImport')) {
        if (process.platform === 'darwin') {
            fs.unlink(filePath, err => {
                if (err) {
                    logger.main.error('Error in handlePextFile: ' + err.message)
                    HandleErrorsElectron.handleError('singleInstance', 'handlePextFile', 'handlePextFile', err)
                }
            })
        } else {
            fs.rm(filePath, err => {
                if (err) {
                    logger.main.error('Error in handlePextFile: ' + err.message)
                    HandleErrorsElectron.handleError('singleInstance', 'handlePextFile', 'handlePextFile', err)
                }
            })
        }
    }
    if (authorized) {
        mainWindow.webContents.send('open-addon', addonName)
    }
}
