export const staticAsset = (assetPath: string): string => {
    const staticBase = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    const normalized = assetPath.replace(/^\/+/, '')
    return `${staticBase}${normalized}`
}
