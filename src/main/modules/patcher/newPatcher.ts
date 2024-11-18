import { app, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { store } from '../storage'
import { mainWindow } from '../../../index'
import axios from 'axios'
import crypto from 'crypto';
import closeYandexMusic, {
    isYandexMusicRunning,
} from '../../utils/appUtils'
import logger from '../logger';

export const handlePatcherEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-app-asar', async (event, { version, link, checksum }) => {
        try {
            const isRunning = await isYandexMusicRunning();
            console.log(isRunning)
            if (isRunning) {
                event.reply('update-message', { message: 'Closing Yandex Music...' });
                await closeYandexMusic();
            }
            const savePath = path.join(
                process.env.LOCALAPPDATA || '',
                'Programs',
                'YandexMusic',
                'resources',
                'app.asar'
            );

            fs.mkdirSync(path.dirname(savePath), { recursive: true });

            const httpsAgent = new https.Agent({
                rejectUnauthorized: false,
            });

            const tempFilePath = path.join(app.getPath('temp'), 'app.asar.download');
            const writer = fs.createWriteStream(tempFilePath);

            const response = await axios.get(link, {
                httpsAgent,
                responseType: 'stream',
            });

            const totalLength = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedLength = 0;

            response.data.on('data', (chunk: Buffer) => {
                downloadedLength += chunk.length;
                const progress = downloadedLength / totalLength;

                if (mainWindow) {
                    mainWindow.setProgressBar(progress);
                }

                event.reply('download-progress', { progress: Math.round(progress * 100) });
            });

            response.data.on('error', (err: Error) => {
                fs.unlink(tempFilePath, () => {});
                logger.main.error('Error during download:', err);

                if (mainWindow) {
                    mainWindow.setProgressBar(-1);
                }

                event.reply('update-failure', { success: false, error: err.message });
            });

            response.data.pipe(writer);

            writer.on('finish', async () => {
                writer.close();

                if (mainWindow) {
                    mainWindow.setProgressBar(-1);
                }

                if (checksum) {
                    const fileBuffer = fs.readFileSync(tempFilePath);
                    const hashSum = crypto.createHash('sha256');
                    hashSum.update(fileBuffer);
                    const hex = hashSum.digest('hex');

                    if (hex !== checksum) {
                        fs.unlink(tempFilePath, () => {});
                        console.error('Checksum does not match');
                        event.reply('update-failure', { success: false, error: 'Checksum does not match' });
                        return;
                    }
                }

                fs.rename(tempFilePath, savePath, (err) => {
                    if (err) {
                        fs.unlink(tempFilePath, () => {});
                        console.error('Error moving file:', err);
                        event.reply('update-failure', { success: false, error: 'Error moving file.' });
                        return;
                    }

                    store.set('patcher.version', version);

                    event.reply('update-success', { success: true });
                });
            });

            writer.on('error', (err: Error) => {
                fs.unlink(tempFilePath, () => {});
                console.error('Error writing file:', err);

                if (mainWindow) {
                    mainWindow.setProgressBar(-1);
                }

                event.reply('update-failure', { success: false, error: err.message });
            });
        } catch (error: any) {
            console.error('Unexpected error:', error);

            if (mainWindow) {
                mainWindow.setProgressBar(-1);
            }

            event.reply('update-failure', { success: false, error: error.message });
        }
    });
}
export const handlePatcher = (window: BrowserWindow): void => {
    handlePatcherEvents(window)
}
