import React, { useMemo } from 'react'
import { CdnImageBaseProps, resolveCdnMedia } from './shared'

export type CdnAnimatedImageProps = CdnImageBaseProps & {
    allowAnimate?: boolean
}

export default function CdnAnimatedImage({
    type,
    hash,
    ext,
    allowAnimate = false,
    onError,
    ...imgProps
}: CdnAnimatedImageProps) {
    const media = useMemo(() => resolveCdnMedia(type, hash, ext, allowAnimate), [allowAnimate, ext, hash, type])

    if (!media?.src) return null

    return <img {...imgProps} src={media.src} srcSet={media.srcSet} onError={onError} />
}
