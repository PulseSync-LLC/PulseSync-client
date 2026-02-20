import React, { useCallback, useEffect, useState } from 'react'
import CdnAnimatedImage, { CdnAnimatedImageProps } from './CdnAnimatedImage'

export type BannerProps = Omit<CdnAnimatedImageProps, 'type'>

const FALLBACK_BANNER_HASH = 'default_banner'
const FALLBACK_BANNER_EXT = 'webp'

export default function Banner({ hash, ext, onError, ...imgProps }: BannerProps) {
    const resolvedHash = hash?.trim() || null
    const [useFallback, setUseFallback] = useState(!resolvedHash)

    useEffect(() => {
        setUseFallback(!resolvedHash)
    }, [resolvedHash, ext])

    const handleCdnError = useCallback(
        (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
            if (!useFallback) {
                setUseFallback(true)
            }

            onError?.(event)
        },
        [onError, useFallback],
    )

    return (
        <CdnAnimatedImage
            type="banner"
            hash={useFallback ? FALLBACK_BANNER_HASH : resolvedHash}
            ext={useFallback ? FALLBACK_BANNER_EXT : ext}
            onError={handleCdnError}
            {...imgProps}
        />
    )
}
