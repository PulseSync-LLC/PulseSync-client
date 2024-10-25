import { app, nativeImage, NativeImage } from 'electron'
import path from 'path'

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

    const filePath = path.join(
        basePath,
        useFor ? useFor + '/' : '',
        `${name}${ext}`,
    )
    return nativeImage.createFromPath(filePath)
}

export { getNativeImg, getNativeImgFromUrl }
