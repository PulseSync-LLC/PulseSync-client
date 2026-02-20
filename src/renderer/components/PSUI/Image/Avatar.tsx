import React, { useCallback, useEffect, useState } from 'react'
import { staticAsset } from '../../../utils/staticAssets'
import CdnAnimatedImage, { CdnAnimatedImageProps } from './CdnAnimatedImage'

export type AvatarProps = Omit<CdnAnimatedImageProps, 'type'>

const FALLBACK_AVATAR_SRC = staticAsset('assets/images/undef.png')

export default function Avatar({ hash, ext, allowAnimate = false, onError, ...imgProps }: AvatarProps) {
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

    if (useFallback) {
        return <img {...imgProps} src={FALLBACK_AVATAR_SRC} onError={onError} />
    }

    return (
        <CdnAnimatedImage
            type="avatar"
            hash={resolvedHash}
            ext={ext}
            allowAnimate={allowAnimate}
            onError={handleCdnError}
            {...imgProps}
        />
    )
}
