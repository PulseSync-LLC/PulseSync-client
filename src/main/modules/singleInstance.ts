import { app, BrowserWindow } from 'electron'
import logger from './logger'
import { prestartCheck } from '../../index'
import { handleUncaughtException } from './handlers/handleError'
import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'original-fs'
import { HandleErrorsElectron } from './handlers/handleErrorsElectron'
import { authorized, queueAddonOpen } from '../events'
import { mainWindow } from './createWindow'
import { clearDirectory } from '../utils/appUtils'
import { getState } from './state'
import RendererEvents from '../../common/types/rendererEvents'

export const isFirstInstance = app.requestSingleInstanceLock()
const State = getState()

const findPextArg = (args: string[]): string | null => {
    for (const raw of [...args].reverse()) {
        if (!raw) continue
        const trimmed = raw.replace(/^["']|["']$/g, '')
        if (!trimmed) continue
        if (path.extname(trimmed).toLowerCase() === '.pext') {
            return trimmed
        }
    }
    return null
}

export const checkForSingleInstance = async (): Promise<void> => {
    logger.main.info('Single instance: ', isFirstInstance ? 'yes' : 'no')
    if (isFirstInstance) {
        const [window] = BrowserWindow.getAllWindows()

        if (process.platform === 'darwin') {
            app.on('open-url', (event, url) => {
                event.preventDefault()
                logger.main.info(`open-url event: ${url}`)
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
                const pextPath = findPextArg(commandLine)
                if (pextPath) {
                    await handlePextFile(pextPath)
                }
                toggleWindowVisibility(window, true)
                logger.main.info('Show window')
            }
        })
        await prestartCheck()
        if (process.platform !== 'darwin') {
            const pextPath = findPextArg(process.argv.slice(1))
            if (pextPath) {
                await handlePextFile(pextPath)
            }
        }
        handleUncaughtException()
    } else {
        logger.main.info('Another instance is already running, quitting this instance.')
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
    metadata.fromPext = true
    const addonName = metadata.name
    if (!addonName) {
        logger.main.error('Theme name missing in metadata.json')
        return
    }

    const outputDir = path.join(app.getPath('userData'), 'addons', addonName)
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    } else {
        await clearDirectory(outputDir)
    }
    zip.extractAllTo(outputDir, true)
    const metadataFilePath = path.join(outputDir, 'metadata.json')
    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, 4))
    logger.main.info(`Extension exported successfully to ${outputDir}`)

    if (State.get('settings.deletePextAfterImport')) {
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
    queueAddonOpen(addonName)
}
