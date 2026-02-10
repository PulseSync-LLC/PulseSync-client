import config from '@common/appConfig'

type Nullable<T> = T | null | undefined

interface AvatarMediaOptions {
    hash?: Nullable<string>
    ext?: Nullable<string>
    animated?: boolean
}

interface BannerMediaOptions {
    hash?: Nullable<string>
    ext?: Nullable<string>
    animated?: boolean
}

interface MediaUrls {
    src: string
    srcSet?: string
}

const BANNER_SIZES = [480, 960, 1440]
const AVATAR_SIZES = [64, 128, 256]

const normalizeHash = (value?: Nullable<string>): string | null => {
    const hash = value?.trim()
    return hash ? hash : null
}

const normalizeExt = (value?: Nullable<string>): string | null => {
    const ext = value?.trim().toLowerCase()
    if (!ext) return null
    return ext.startsWith('.') ? ext.slice(1) : ext
}

const withS3 = (path: string) => `${config.S3_URL}/${path}`

const buildSrcSet = ({basePath, ext, sizes}: {basePath: string, ext?: string | null, sizes: number[]}) =>
    sizes.map(size => `${withS3(`${basePath}_${size}.${ext || 'webp'}`)} ${size}w`).join(', ')

export const getAvatarMediaUrls = ({ hash, ext, animated = false }: AvatarMediaOptions): MediaUrls | null => {
    const normalizedHash = normalizeHash(hash)
    if (!normalizedHash) return null

    const normalizedExt = normalizeExt(ext)

    let originalPath = `avatars/${normalizedHash}.${normalizedExt || 'webp'}`
    let srcSet = undefined

    if (normalizedExt === 'gif') {
        if (animated) {
            originalPath = `avatars/${normalizedHash}.gif`
        } else {
            originalPath = `avatars/${normalizedHash}_preview.webp`
        }
    } else {
        srcSet = buildSrcSet({ basePath: `avatars/${normalizedHash}`, ext: normalizedExt, sizes: AVATAR_SIZES })
    }

    return {
        srcSet: srcSet?.concat(', ').concat(withS3(originalPath)).concat(' 1600w'),
        src: withS3(originalPath),
    }
}

export const getBannerMediaUrls = ({ hash, ext, animated = false }: BannerMediaOptions): MediaUrls | null => {
    const normalizedHash = normalizeHash(hash)
    if (!normalizedHash) return null

    const normalizedExt = normalizeExt(ext)

    let originalPath = `banners/${normalizedHash}.${normalizedExt || 'webp'}`
    let srcSet = undefined

    if (normalizedExt === 'gif') {
        if (animated) {
            originalPath = `banners/${normalizedHash}.gif`
        } else {
            originalPath = `banners/${normalizedHash}_preview.webp`
        }
    } else {
        srcSet = buildSrcSet({ basePath: `banners/${normalizedHash}`, ext: normalizedExt, sizes: BANNER_SIZES })
    }

    return {
        srcSet: srcSet?.concat(', ').concat(withS3(originalPath)).concat(' original'),
        src: withS3(originalPath),
    }
}
