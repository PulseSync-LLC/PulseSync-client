const host = process.env.PULSESYNC_REMOTE_RENDERER_HOST || '127.0.0.1'
const port = Number(process.env.PULSESYNC_REMOTE_RENDERER_PORT || 3100)
const rendererPath = process.env.PULSESYNC_REMOTE_RENDERER_PATH || '/src/renderer/index.html'
const origin = `http://${host}:${port}`
const manifestPath = '/desktop/manifest.json'

export const remoteRendererDevConfig = {
    host,
    port,
    rendererPath,
    origin,
    manifestPath,
    rendererUrl: `${origin}${rendererPath}`,
    manifestUrl: `${origin}${manifestPath}`,
}
