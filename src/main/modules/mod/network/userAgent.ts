import { app } from 'electron'

export const getPulseSyncUserAgent = (): string => {
    const chromeVersion = process.versions.chrome || '150.0.0.0'
    const electronVersion = process.versions.electron || '43.0.0'

    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/${chromeVersion} Electron/${electronVersion} Safari/537.36`
}
