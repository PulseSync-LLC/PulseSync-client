import { BrowserWindow, app } from 'electron'
import RendererEvents from '../../common/types/rendererEvents'
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
import { t } from '../i18n'

let musicPath: string
;(async () => {
    try {
        musicPath = await getPathToYandexMusic()
    } catch (err) {
        logger.modManager.error(t('main.ffmpeg.pathError'), err)
    }
})()
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

const getExecName = (plat: NodeJS.Platform) => (plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

const ensureExecutable = async (filePath: string, plat: NodeJS.Platform) => {
    if (plat !== 'win32') {
        await fs.promises.chmod(filePath, 0o755)
    }
}

const copyExecutable = async (src: string, dest: string, plat: NodeJS.Platform) => {
    await fs.promises.copyFile(src, dest)
    await ensureExecutable(dest, plat)
}

const getFfmpegPaths = (plat: NodeJS.Platform) => {
    const execName = getExecName(plat)
    const execDestPath = path.join(musicPath, execName)
    const userDataPath = app.getPath('userData')
    const storageDir = path.join(userDataPath, 'ffmpeg')
    const storageExecPath = path.join(storageDir, execName)
    return { execName, execDestPath, storageDir, storageExecPath }
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

    window.webContents.send(RendererEvents.FFMPEG_DOWNLOAD_STATUS, {
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
        sendStatus(window, t('main.ffmpeg.platformNotSupported'), 100, false)
        return
    }

    const { execName, execDestPath, storageDir, storageExecPath } = getFfmpegPaths(plat)

    try {
        if (fs.existsSync(storageExecPath)) {
            sendStatus(window, t('main.ffmpeg.foundInStorage'), 10)
            await copyExecutable(storageExecPath, execDestPath, plat)
            sendStatus(window, t('main.ffmpeg.installSuccess'), 100, true)
            return
        }

        await fs.promises.mkdir(storageDir, { recursive: true })

        const archivePath = path.join(storageDir, cfg.archiveName)
        await downloadFile(cfg.url, archivePath, p => {
            const prog = Math.round(p * 0.7)
            sendStatus(window, t('main.ffmpeg.downloading'), prog)
        })

        sendStatus(window, t('main.ffmpeg.extracting'), 70)
        if (cfg.extractType === 'zip') {
            await extractZip(archivePath, storageDir)
        } else {
            await extractTarXZ(archivePath, storageDir)
        }
        sendStatus(window, t('main.ffmpeg.extractComplete'), 90)

        const relPattern = cfg.execRelPath.replace(/\\/g, '/')
        const storagePosix = storageDir.split(path.sep).join('/')
        const pattern = `${storagePosix}/${relPattern}`
        const matches = await glob(pattern, { nodir: true })
        if (!matches.length) {
            throw new Error('FFmpeg binary not found in extracted files')
        }
        const execSrc = matches[0]

        await copyExecutable(execSrc, storageExecPath, plat)

        const items = await fs.promises.readdir(storageDir)
        for (const name of items) {
            if (name === execName) continue
            const p = path.join(storageDir, name)
            await fs.promises.rm(p, { recursive: true, force: true })
        }

        sendStatus(window, t('main.ffmpeg.installing'), 95)
        await copyExecutable(storageExecPath, execDestPath, plat)
        sendStatus(window, t('main.ffmpeg.installSuccess'), 100, true)
    } catch (err: any) {
        logger.modManager.error('installFfmpeg error:', err)
        sendStatus(window, t('main.ffmpeg.installError', { message: err.message }), 100, false)
    }
}

export async function deleteFfmpeg() {
    const plat = process.platform
    const { execDestPath } = getFfmpegPaths(plat)

    if (fs.existsSync(execDestPath)) {
        await fs.promises.rm(execDestPath)
        logger.modManager.info('FFmpeg removed from Yandex.Music')
    } else {
        logger.modManager.warn('FFmpeg not found for removal in Yandex.Music')
    }
}
