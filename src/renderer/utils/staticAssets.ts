const STATIC_BASE = '../static'

export const staticAsset = (assetPath: string): string => {
    const normalized = assetPath.replace(/^\/+/, '')
    return `${STATIC_BASE}/${normalized}`
}
