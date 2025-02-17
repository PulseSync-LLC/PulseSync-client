import { app, dialog, IpcMainEvent, shell } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import https from 'https'
import { getPercent } from '../../../renderer/utils/percentage'
import { decryptData } from '../../../renderer/utils/track'
import logger from '../../modules/logger'
import { Track } from '../../../renderer/api/interfaces/track.interface'
import isAppDev from 'electron-is-dev'
import { exec } from 'child_process'
import util from 'util'
import { mainWindow } from '../../../index'
const execPromise = util.promisify(exec)

const ffmpegPath = isAppDev
    ? path.join(__dirname, '..', '..', 'modules', 'ffmpeg.exe')
    : path.join(__dirname, '..', '..', '..', '..', 'modules', 'ffmpeg.exe')

export async function downloadTrack(
    event: IpcMainEvent,
    val: {
        url: string
        track: Track
        askSavePath: boolean
        saveAsMp3: boolean
    },
) {
    const musicDir = app.getPath('music')
    const downloadDir = path.join(musicDir, 'PulseSyncMusic')

    const fileExtension = val.saveAsMp3
        ? 'mp3'
        : val.track.downloadInfo.codec
              .replaceAll(/(he-)?aac/g, 'm4a')
              .replace(/(.*)-mp4/, '$1')

    const defaultFilepath = path.join(
        downloadDir,
        `${artists2string(val.track?.artists)} — ${val.track?.title}.`.replace(
            /[/\\?%*:|"<>]/g,
            '_',
        ) + fileExtension,
    )

    let filePath: string | undefined
    if (val.askSavePath) {
        const { canceled, filePath: selectedPath } = await dialog.showSaveDialog({
            title: 'Сохранить трек',
            defaultPath: defaultFilepath,
            filters: [{ name: 'Трек', extensions: [fileExtension] }],
        })
        if (canceled || !selectedPath || !val.url) {
            return mainWindow.webContents.send('download-track-cancelled')
        }
        filePath = selectedPath
    } else {
        filePath = defaultFilepath
    }

    const tempDir = path.join(os.tmpdir(), val.track.downloadInfo.trackId)
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
    }
    fs.mkdirSync(tempDir, { recursive: true })
    const tempTrackPath = path.join(tempDir, `track.${fileExtension}`)

    https
        .get(val.url, (response) => {
            const chunks: Buffer[] = []
            let downloadedBytes = 0
            const totalFileSize = parseInt(
                response.headers['content-length'] as string,
                10,
            )
            response.on('data', (chunk) => {
                chunks.push(chunk)
                downloadedBytes += chunk.length
                const percent = getPercent(downloadedBytes, totalFileSize)
                if (percent <= 55) {
                    mainWindow.setProgressBar(percent / 100)
                    event.sender.send('download-track-progress', percent)
                }
            })
            response.on('end', async () => {
                try {
                    let buffer = Buffer.concat(chunks)
                    if (val.track.downloadInfo?.transport === 'encraw') {
                        const arrayBuffer = buffer.buffer.slice(
                            buffer.byteOffset,
                            buffer.byteOffset + buffer.byteLength,
                        )
                        const decryptedArrayBuffer = await decryptData({
                            key: val.track.downloadInfo.key,
                            data: arrayBuffer,
                        })
                        buffer = Buffer.from(decryptedArrayBuffer)
                    }
                    fs.writeFileSync(tempTrackPath, buffer)
                    event.sender.send('download-track-progress', 60)
                    mainWindow.setProgressBar(60)

                    let withCover = false
                    let coverPath = ''
                    if (val.track.coverUri) {
                        coverPath = path.join(tempDir, 'cover.jpg')
                        const coverUrl =
                            'https://' + val.track.coverUri.replace('%%', '400x400')
                        const coverResponse = await fetch(coverUrl)
                        const coverBuffer = Buffer.from(
                            await coverResponse.arrayBuffer(),
                        )
                        fs.writeFileSync(coverPath, coverBuffer)
                        withCover = true
                    }
                    event.sender.send('download-track-progress', 80)
                    mainWindow.setProgressBar(80)

                    let ffmpegCommand = `"${ffmpegPath}" -y -i "${tempTrackPath}" `
                    if (withCover) {
                        ffmpegCommand += `-i "${coverPath}" `
                    }
                    ffmpegCommand += `-map 0:a `
                    if (withCover) {
                        ffmpegCommand += `-map 1 `
                    }
                    if (val.track.downloadInfo.codec === 'mp3') {
                        ffmpegCommand += `-id3v2_version 3 -c:a copy `
                    } else if (val.saveAsMp3) {
                        ffmpegCommand += `-c:a libmp3lame -b:a 320k -id3v2_version 3 `
                    } else {
                        ffmpegCommand += `-c:a copy `
                    }

                    if (withCover) {
                        ffmpegCommand += `-c:v mjpeg -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" -disposition:v attached_pic `
                    }
                    if (val.track?.artists) {
                        ffmpegCommand += `-metadata artist="${artists2string(val.track.artists)}" `
                    }
                    if (val.track?.title) {
                        ffmpegCommand += `-metadata title="${val.track.title}" `
                    }
                    if (val.track?.albums?.[0]?.title) {
                        ffmpegCommand += `-metadata album="${val.track.albums[0].title}" `
                    }
                    ffmpegCommand += `"${filePath}"`

                    try {
                        await execPromise(ffmpegCommand)
                        event.sender.send('download-track-progress', 99)
                        mainWindow.setProgressBar(100)
                        event.sender.send('download-track-finished')
                        shell.showItemInFolder(filePath)
                        fs.rmSync(tempDir, { recursive: true, force: true })
                        setTimeout(() => {
                            mainWindow.setProgressBar(-1)
                        }, 1000)
                    } catch (err) {
                        logger.main.error('Error while encoding track:', err)
                        event.sender.send('download-track-failed')
                        mainWindow.setProgressBar(-1)
                        fs.rmSync(tempDir, { recursive: true, force: true })
                    }
                } catch (err) {
                    logger.main.error('Error in ffmpeg:', err)
                    event.sender.send('download-track-failed')
                    mainWindow.setProgressBar(-1)
                    fs.rmSync(tempDir, { recursive: true, force: true })
                }
            })
        })
        .on('error', (err) => {
            logger.main.error('Error while downloading track:', err)
            event.sender.send('download-track-failed')
        })
}

function artists2string(artists: Track['artists']) {
    if (!artists) return
    if (artists.length <= 1) return artists[0].name
    let string = artists.shift()?.name
    artists.forEach((a) => {
        string += ' & ' + a.name
    })
    return string
}
