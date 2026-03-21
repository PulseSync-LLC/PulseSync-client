import React from 'react'
import Shimmer, { type ShimmerVariant } from '@shared/ui/PSUI/Shimmer'

export default function Loader({ variant = 'store' }: { text?: string; variant?: ShimmerVariant }) {
    return <Shimmer variant={variant} />
}
