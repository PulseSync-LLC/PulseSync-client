export const staticAsset = (assetPath: string): string => {
    const normalized = assetPath.replace(/^\/+/, '')
    const assetPathNormalized = normalized.startsWith('assets/') ? normalized : `assets/${normalized}`
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
    return `${base}${assetPathNormalized}`
}
