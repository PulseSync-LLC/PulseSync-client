import { app, nativeImage } from 'electron'

import path from 'path'

const getNativeImg = (name: string, ext: string, useFor?: string) => {
    const basePath = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(app.getAppPath(), 'static', 'assets')
    const filePath = path.join(basePath, useFor ? useFor + '/' : '', `${name}${ext}`)
    return nativeImage.createFromPath(filePath)
}
export { getNativeImg }
