export const staticAsset = (assetPath: string): string => {
    const normalized = assetPath.replace(/^\/+/, '')
    const assetPathNormalized = normalized.startsWith('assets/') ? normalized : `assets/${normalized}`
    if (import.meta.env.DEV) {
        const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
        return `${base}${assetPathNormalized}`
    }
    const url = new URL(window.location.href)

    const asarMatch = url.pathname.match(/^(.+?app\.asar)/)
    if (asarMatch) {
        const asarBase = asarMatch[1]
        const assetFile = assetPathNormalized.replace(/^assets\//, '')
        url.pathname = `${asarBase}/.vite/renderer/assets/${assetFile}`
    } else {
        url.pathname = url.pathname.replace(/app\.asar\/.*$/, 'app.asar/assets/')
    }

    return url.toString()
}
