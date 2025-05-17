import { BrowserWindow, app, ipcMain } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import axios from 'axios'
import { glob } from 'glob'
import unzipper from 'unzipper'
import tar from 'tar'
import { pipeline } from 'stream/promises'
import logger from '../modules/logger'
import { getPathToYandexMusic } from './appUtils'

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
        url: 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip',
        archiveName: 'ffmpeg-macos.zip',
        extractType: 'zip',
        execRelPath: 'ffmpeg',
    },
    win32: {
        url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        archiveName: 'ffmpeg-win.zip',
        extractType: 'zip',
        execRelPath: '**/bin/ffmpeg.exe',
    },
    linux: {
        url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
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

export async function extractZip(src: string, dest: string) {
    await fs
        .createReadStream(src)
        .pipe(unzipper.Extract({ path: dest }))
        .promise()
}

export async function extractTarXZ(src: string, dest: string) {
    await tar.x({ file: src, cwd: dest })
}

export function sendStatus(window: BrowserWindow, message: string, progress: number, success?: boolean) {
    window.webContents.send('ffmpeg-download-status', { message, progress, success })
}

export async function installFfmpeg(window: BrowserWindow) {
    const plat = process.platform
    const cfg = FFMPEG_INSTALL[plat]
    const installDir = getPathToYandexMusic()
    const execName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const execDestPath = path.join(installDir, execName)

    if (fs.existsSync(execDestPath)) {
        sendStatus(window, 'FFmpeg уже установлен', 100, true)
        return
    }

    const tmpDir = path.join(os.tmpdir(), 'ffmpeg-temp')
    try {
        if (!cfg) {
            sendStatus(window, 'Платформа не поддерживается', 100, false)
            return
        }
        await fs.promises.mkdir(tmpDir, { recursive: true })

        const archivePath = path.join(tmpDir, cfg.archiveName)
        await downloadFile(cfg.url, archivePath, p => {
            const prog = Math.round(p * 0.7)
            sendStatus(window, 'Загрузка FFmpeg...', prog)
        })

        sendStatus(window, 'Распаковка архива...', 70)
        if (cfg.extractType === 'zip') {
            await extractZip(archivePath, tmpDir)
        } else {
            await extractTarXZ(archivePath, tmpDir)
        }
        sendStatus(window, 'Распаковка завершена', 90)

        const tmpPosix = tmpDir.split(path.sep).join('/')
        const relPattern = cfg.execRelPath.replace(/\\/g, '/')
        const pattern = `${tmpPosix}/${relPattern}`
        const matches = await glob(pattern, { nodir: true })
        if (!matches.length) {
            throw new Error('Не найден бинарь FFmpeg в распакованных файлах')
        }
        const execSrc = matches[0]

        await fs.promises.mkdir(installDir, { recursive: true })
        sendStatus(window, 'Установка FFmpeg...', 95)
        await fs.promises.copyFile(execSrc, execDestPath)
        if (plat !== 'win32') {
            await fs.promises.chmod(execDestPath, 0o755)
        }

        sendStatus(window, 'FFmpeg успешно установлен', 100, true)
    } catch (err: any) {
        logger.modManager.error('installFfmpeg error:', err)
        sendStatus(window, `Ошибка установки: ${err.message}`, 100, false)
    } finally {
        try {
            await fs.promises.rm(tmpDir, { recursive: true, force: true })
        } catch (cleanupErr: any) {
            logger.modManager.warn('Не удалось удалить временную папку:', cleanupErr)
        }
    }
}
export async function deleteFfmpeg() {
    const plat = process.platform
    const execName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const execDestPath = path.join(getPathToYandexMusic(), execName)

    if (fs.existsSync(execDestPath)) {
        await fs.promises.rm(execDestPath)
        logger.modManager.info('FFmpeg удален')
    } else {
        logger.modManager.warn('FFmpeg не найден для удаления')
    }
}
