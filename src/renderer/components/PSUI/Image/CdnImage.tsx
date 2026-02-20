import React, { useMemo } from 'react'
import { CdnImageBaseProps, resolveCdnMedia } from './shared'

export type CdnImageProps = CdnImageBaseProps

export default function CdnImage({
    type,
    hash,
    ext,
    onError,
    ...imgProps
}: CdnImageProps) {
    const media = useMemo(() => resolveCdnMedia(type, hash, ext, false), [ext, hash, type])

    if (!media?.src) return null

    return <img {...imgProps} src={media.src} srcSet={media.srcSet} onError={onError} />
}
