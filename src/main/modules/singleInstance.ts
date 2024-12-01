import { app, BrowserWindow } from 'electron'
import { checkIsDeeplink, navigateToDeeplink } from './handlers/handleDeepLink'
import logger from './logger'
import httpServer from './httpServer'
import config from '../../config.json'
import { mainWindow, prestartCheck } from '../../index'
import {handleUncaughtException} from "./handlers/handleError";
import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'fs'
export const isFirstInstance = app.requestSingleInstanceLock()

export const checkForSingleInstance = (): void => {
    logger.main.info('Single instance')
    console.log(isFirstInstance)
    if (isFirstInstance) {
        const [window] = BrowserWindow.getAllWindows()
        app.on(
            'second-instance',
            (event: Electron.Event, commandLine: string[]) => {
                console.log(commandLine)
                if (window) {
                    if (window.isMinimized()) {
                        window.restore()
                        logger.main.info('Restore window')
                    }
                    const lastCommandLineArg = commandLine.pop();
                    console.log(lastCommandLineArg)
                    if (lastCommandLineArg) {
                        if (checkIsDeeplink(lastCommandLineArg)) {
                            navigateToDeeplink(window, lastCommandLineArg);
                        } else if (lastCommandLineArg.endsWith('.pext')) {
                            handlePextFile(lastCommandLineArg);
                        }
                    }
                    toggleWindowVisibility(window, true)
                    logger.main.info('Show window')
                }
            },
        )
        prestartCheck()
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
/**
 * Обрабатывает файл .pext: извлекает metadata.json и распаковывает содержимое в папку с именем темы
 * @param filePath Путь к файлу .pext
 */
async function handlePextFile(filePath: string) {
    const zip = new AdmZip(filePath);
    const tempDir = path.join(app.getPath('temp'), `pext-import-${Date.now()}`);
    fs.mkdirSync(tempDir);

    zip.extractAllTo(tempDir, true);

    const metadataPath = path.join(tempDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
        logger.main.error("Missing metadata.json");
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    const themeName = metadata.name;
    if (!themeName) {
        logger.main.error("Name theme missing in metadata.json");
    }

    const outputDir = path.join(app.getPath('userData'), "themes", themeName);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    zip.extractAllTo(outputDir, true);

    logger.main.info(`Extension exported successfully to ${outputDir}`);
    mainWindow.webContents.send('open-theme', themeName)
}