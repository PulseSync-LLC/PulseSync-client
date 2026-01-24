export const staticAsset = (assetPath: string): string => {
    const normalized = assetPath.replace(/^\/+/, '')
    if (typeof window === 'undefined') {
        return normalized
    }
    try {
        const current = new URL(window.location.href)
        if (current.protocol === 'file:') {
            const marker = '/.vite/renderer/'
            const markerIndex = current.pathname.lastIndexOf(marker)
            if (markerIndex !== -1) {
                const rootPath = current.pathname.slice(0, markerIndex + marker.length)
                const base = new URL(`file://${rootPath}`)
                return new URL(`assets/${normalized}`, base).toString()
            }
            return new URL(normalized, current).toString()
        }
        return new URL(`assets/${normalized}`, `${current.origin}/`).toString()
    } catch {
        return normalized
    }
}
