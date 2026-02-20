import type { ImgHTMLAttributes } from 'react'
import { getAvatarMediaUrls, getBannerMediaUrls } from '../../../utils/mediaVariants'

export type CdnMediaType = 'avatar' | 'banner'

export type CdnImageBaseProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'type'> & {
    type: CdnMediaType
    hash?: string | null
    ext?: string | null
}

export const resolveCdnMedia = (type: CdnMediaType, hash?: string | null, ext?: string | null, animated = false) => {
    if (!hash) return null

    if (type === 'avatar') {
        return getAvatarMediaUrls({ hash, ext, animated })
    }

    return getBannerMediaUrls({ hash, ext, animated })
}
