import { app, nativeImage, NativeImage } from 'electron'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import logger from './modules/logger'

const getNativeImgFromUrl = async (url: string): Promise<NativeImage> => {
    const res = await fetch(`https://${url.replaceAll('%%', '100x100')}`)

    return nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
}
const getNativeImg = (name: string, ext: string, useFor?: string) => {
    const basePath = app.isPackaged
        ? path.join(
              process.resourcesPath,
              'app.asar',
              '.webpack',
              'renderer',
              'static',
              'assets',
          )
        : path.join(__dirname, '..', '..', 'static', 'assets')

    const filePath = path.join(basePath, useFor ? useFor + '/' : '', `${name}${ext}`)
    return nativeImage.createFromPath(filePath)
}
export function convertToMP3(
    inputFilePath: string,
    outputDir: string,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const outputFilePath = path.join(
            outputDir,
            `${path.basename(inputFilePath, path.extname(inputFilePath))}.mp3`,
        )

        ffmpeg(inputFilePath)
            .audioCodec('libmp3lame')
            .audioBitrate(320)
            .on('start', () => {
                logger.main.info(`Начата конвертация файла: ${inputFilePath}`)
            })
            .on('error', (err) => {
                logger.main.error(`Ошибка конвертации: ${err.message}`)
                reject(err)
            })
            .on('end', () => {
                logger.main.info(
                    `Конвертация завершена. Файл сохранен: ${outputFilePath}`,
                )
                resolve(outputFilePath)
            })
            .save(outputFilePath)
    })
}
export async function handleFileConversion(
    inputFilePath: string,
    outputDir: string,
) {
    const extension = path.extname(inputFilePath).toLowerCase()
    if (['.flac', '.aac'].includes(extension)) {
        try {
            return await convertToMP3(inputFilePath, outputDir)
        } catch (error) {
            console.error('Ошибка во время конвертации:', error)
        }
    } else {
        console.log('Файл уже в формате MP3 или неподдерживаемый формат.')
    }
}
export { getNativeImg, getNativeImgFromUrl }
