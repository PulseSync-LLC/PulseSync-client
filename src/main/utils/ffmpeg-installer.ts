import { BrowserWindow, app } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import axios from 'axios'
import { glob } from 'glob'
import * as tar from 'tar'
import { pipeline } from 'stream/promises'
import AdmZip from 'adm-zip'
import logger from '../modules/logger'
import { getPathToYandexMusic } from './appUtils'

let musicPath: string
(async () => {
    try {
        musicPath = await getPathToYandexMusic();
    } catch (err) {
        logger.modManager.error('Ошибка при получении пути:', err);
    }
})();
export const FFMPEG_INSTALL: Record<
    string,
    {
        url: string
        archiveName: string
        extractType: 'zip' | 'tar'
        execRelPath: string
    }
> = {
    darwin: {
        url: 'https://raw.githubusercontent.com/foreA-adoxid/ffmpeg-builds/main/darwin/ffmpeg-darwin.zip',
        archiveName: 'ffmpeg-darwin.zip',
        extractType: 'zip',
        execRelPath: 'ffmpeg',
    },
    win32: {
        url: 'https://raw.githubusercontent.com/foreA-adoxid/ffmpeg-builds/main/windows/ffmpeg-windows.zip',
        archiveName: 'ffmpeg-win.zip',
        extractType: 'zip',
        execRelPath: '**/bin/ffmpeg.exe',
    },
    linux: {
        url: 'https://raw.githubusercontent.com/foreA-adoxid/ffmpeg-builds/main/linux/ffmpeg-linux.tar.xz',
        archiveName: 'ffmpeg-linux.tar.xz',
        extractType: 'tar',
        execRelPath: 'ffmpeg-*-amd64-static/ffmpeg',
    },
}

export async function downloadFile(url: string, dest: string, onProgress: (percent: number) => void) {
    const response = await axios.get(url, { responseType: 'stream' })
    const total = parseInt(response.headers['content-length'] || '0', 10)
    let received = 0
    const writer = fs.createWriteStream(dest)
    response.data.on('data', (chunk: Buffer) => {
        received += chunk.length
        const percent = total ? Math.round((received / total) * 100) : 0
        onProgress(percent)
    })
    await pipeline(response.data, writer)
}

export async function extractZip(src: string, dest: string): Promise<void> {
    const zip = new AdmZip(src)
    zip.extractAllTo(dest, true)
}

export async function extractTarXZ(src: string, dest: string) {
    await tar.x({ file: src, cwd: dest })
}

export function sendStatus(window: BrowserWindow, message: string, progress: number, success?: boolean): void {
    const fraction = Math.min(Math.max(progress / 100, 0), 1)
    window.setProgressBar(fraction)

    window.webContents.send('ffmpeg-download-status', {
        message,
        progress,
        success,
    })

    if (success) {
        window.setProgressBar(-1)
    }
}

export async function installFfmpeg(window: BrowserWindow) {
    const plat = process.platform
    const cfg = FFMPEG_INSTALL[plat]
    if (!cfg) {
        sendStatus(window, 'Платформа не поддерживается', 100, false)
        return
    }

    const execName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const execDestPath = path.join(musicPath, execName)

    const userDataPath = app.getPath('userData')
    const storageDir = path.join(userDataPath, 'ffmpeg')
    const storageExecPath = path.join(storageDir, execName)

    try {
        if (fs.existsSync(storageExecPath)) {
            sendStatus(window, 'FFmpeg найден в хранилище, устанавливаю...', 10)
            await fs.promises.copyFile(storageExecPath, execDestPath)
            if (plat !== 'win32') {
                await fs.promises.chmod(execDestPath, 0o755)
            }
            sendStatus(window, 'FFmpeg успешно установлен', 100, true)
            return
        }

        await fs.promises.mkdir(storageDir, { recursive: true })

        const archivePath = path.join(storageDir, cfg.archiveName)
        await downloadFile(cfg.url, archivePath, p => {
            const prog = Math.round(p * 0.7)
            sendStatus(window, 'Загрузка FFmpeg...', prog)
        })

        sendStatus(window, 'Распаковка архива...', 70)
        if (cfg.extractType === 'zip') {
            await extractZip(archivePath, storageDir)
        } else {
            await extractTarXZ(archivePath, storageDir)
        }
        sendStatus(window, 'Распаковка завершена', 90)

        const relPattern = cfg.execRelPath.replace(/\\/g, '/')
        const storagePosix = storageDir.split(path.sep).join('/')
        const pattern = `${storagePosix}/${relPattern}`
        const matches = await glob(pattern, { nodir: true })
        if (!matches.length) {
            throw new Error('FFmpeg binary not found in extracted files')
        }
        const execSrc = matches[0]

        await fs.promises.copyFile(execSrc, storageExecPath)
        if (plat !== 'win32') {
            await fs.promises.chmod(storageExecPath, 0o755)
        }

        const items = await fs.promises.readdir(storageDir)
        for (const name of items) {
            if (name === execName) continue
            const p = path.join(storageDir, name)
            await fs.promises.rm(p, { recursive: true, force: true })
        }

        sendStatus(window, 'Установка FFmpeg...', 95)
        await fs.promises.copyFile(storageExecPath, execDestPath)
        if (plat !== 'win32') {
            await fs.promises.chmod(execDestPath, 0o755)
        }
        sendStatus(window, 'FFmpeg успешно установлен', 100, true)
    } catch (err: any) {
        logger.modManager.error('installFfmpeg error:', err)
        sendStatus(window, `Ошибка установки: ${err.message}`, 100, false)
    }
}

export async function deleteFfmpeg() {
    const plat = process.platform
    const execName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const installPath = path.join(musicPath, execName)

    if (fs.existsSync(installPath)) {
        await fs.promises.rm(installPath)
        logger.modManager.info('FFmpeg removed from Yandex.Music')
    } else {
        logger.modManager.warn('FFmpeg not found for removal in Yandex.Music')
    }
}
