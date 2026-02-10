import config from '@common/appConfig'

type Nullable<T> = T | null | undefined

interface AvatarMediaOptions {
    hash?: Nullable<string>
    ext?: Nullable<string>
    cssSize: number
    animated?: boolean
}

interface BannerMediaOptions {
    hash?: Nullable<string>
    ext?: Nullable<string>
    cssSize: number
}

interface MediaUrls {
    variantUrl: string
    originalUrl: string
}

const getDevicePixelRatio = () => (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1)

const normalizeHash = (value?: Nullable<string>): string | null => {
    const hash = value?.trim()
    return hash ? hash : null
}

const normalizeExt = (value?: Nullable<string>): string | null => {
    const ext = value?.trim().toLowerCase()
    return ext ? ext : null
}

const withS3 = (path: string) => `${config.S3_URL}/${path}`

export const getAvatarVariantSize = (cssSize: number): 64 | 128 | 256 => {
    const target = Math.ceil(cssSize * getDevicePixelRatio())
    if (target <= 64) return 64
    if (target <= 128) return 128
    return 256
}

export const getBannerVariantSize = (cssSize: number): 480 | 960 | 1440 => {
    const target = Math.ceil(cssSize * getDevicePixelRatio())
    if (target <= 480) return 480
    if (target <= 960) return 960
    return 1440
}

export const getAvatarMediaUrls = ({ hash, ext, cssSize, animated = false }: AvatarMediaOptions): MediaUrls | null => {
    const normalizedHash = normalizeHash(hash)
    if (!normalizedHash) return null

    const normalizedExt = normalizeExt(ext)
    const size = getAvatarVariantSize(cssSize)

    let variantPath = `avatars/${normalizedHash}_${size}.webp`
    if (normalizedExt === 'gif') {
        variantPath = animated ? `avatars/${normalizedHash}.gif` : `avatars/${normalizedHash}_preview_${size}.webp`
    }

    const originalPath = `avatars/${normalizedHash}.${normalizedExt || 'webp'}`

    return {
        variantUrl: withS3(variantPath),
        originalUrl: withS3(originalPath),
    }
}

export const getBannerMediaUrls = ({ hash, ext, cssSize }: BannerMediaOptions): MediaUrls => {
    const normalizedHash = normalizeHash(hash) || 'default_banner'
    const normalizedExt = normalizeExt(ext) || 'webp'
    const size = getBannerVariantSize(cssSize)

    return {
        variantUrl: withS3(`banners/${normalizedHash}_${size}.webp`),
        originalUrl: withS3(`banners/${normalizedHash}.${normalizedExt}`),
    }
}

export const loadFirstAvailableImage = (
    urls: Array<Nullable<string>>,
    onResolved: (url: string) => void,
    onFailed?: () => void,
): (() => void) => {
    const candidates = urls.filter((url): url is string => !!url)
    let cancelled = false

    const tryLoad = (index: number) => {
        if (cancelled) return
        if (index >= candidates.length) {
            onFailed?.()
            return
        }

        const candidate = candidates[index]
        const img = new Image()
        img.onload = () => {
            if (!cancelled) onResolved(candidate)
        }
        img.onerror = () => {
            tryLoad(index + 1)
        }
        img.src = candidate
    }

    tryLoad(0)

    return () => {
        cancelled = true
    }
}
