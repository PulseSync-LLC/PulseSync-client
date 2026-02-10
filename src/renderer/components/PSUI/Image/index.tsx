import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { getAvatarMediaUrls, getBannerMediaUrls } from '../../../utils/mediaVariants'

type MediaType = 'avatar' | 'banner'

type MediaImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'type'> & {
    type: MediaType
    hash?: string | null
    ext?: string | null
    allowAnimation?: boolean
    fallbackSrc?: string
    fallbackHash?: string | null
    fallbackExt?: string | null
}

const resolveMedia = (type: MediaType, hash?: string | null, ext?: string | null, allowAnimation?: boolean) => {
    if (!hash) return null

    if (type === 'avatar') {
        return getAvatarMediaUrls({ hash, ext, animated: allowAnimation })
    }

    return getBannerMediaUrls({ hash, ext, animated: allowAnimation })
}

export default function Image({
    type,
    hash,
    ext,
    allowAnimation = false,
    fallbackSrc,
    fallbackHash,
    fallbackExt,
    onError,
    ...imgProps
}: MediaImageProps) {

    const [triedFallback, setTriedFallback] = useState(false);

    const media = useMemo(() => resolveMedia(type, hash, ext, allowAnimation), [allowAnimation, ext, hash, type])
    const fallbackMedia = useMemo(
        () => resolveMedia(type, fallbackHash, fallbackExt, allowAnimation),
        [allowAnimation, fallbackExt, fallbackHash, type],
    )
    const fallbackAppliedRef = useRef(false)

    const resolvedSrc = media?.src || fallbackMedia?.src || fallbackSrc
    let resolvedSrcSet = media?.srcSet || fallbackMedia?.srcSet

    useEffect(() => {
        fallbackAppliedRef.current = false
    }, [resolvedSrc, fallbackMedia?.src, fallbackSrc])

    const handleError = useCallback(
        (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
            {
                if (!fallbackAppliedRef.current) {
                    const nextSrc = fallbackMedia?.src || fallbackSrc
                    if (nextSrc) {
                        fallbackAppliedRef.current = true
                        event.currentTarget.src = nextSrc
                        if (fallbackMedia?.srcSet) {
                            event.currentTarget.srcset = fallbackMedia.srcSet
                        } else {
                            event.currentTarget.srcset = ''
                        }
                    }
                }
            }

            onError?.(event)
        },
        [fallbackMedia?.src, fallbackMedia?.srcSet, fallbackSrc, onError, triedFallback],
    )

    if (!resolvedSrc) return null

    return <img {...imgProps} src={resolvedSrc} srcSet={resolvedSrcSet} onError={handleError}  />
}
