import React from 'react'

import cn from 'clsx'

import ExtensionShimmer from '@shared/ui/PSUI/Shimmer/variants/ExtensionShimmer'
import ModChangelogShimmer from '@shared/ui/PSUI/Shimmer/variants/ModChangelogShimmer'
import PanelShimmer from '@shared/ui/PSUI/Shimmer/variants/PanelShimmer'
import ProfileShimmer from '@shared/ui/PSUI/Shimmer/variants/ProfileShimmer'
import StoreShimmer from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer'
import UsersShimmer from '@shared/ui/PSUI/Shimmer/variants/UsersShimmer'

import * as styles from '@shared/ui/PSUI/Shimmer/Shimmer.module.scss'

import type { ShimmerProps, ShimmerVariant } from '@shared/ui/PSUI/Shimmer/model/types'

export type { ShimmerProps, ShimmerVariant }

const VARIANT_COMPONENTS: Record<ShimmerVariant, React.FC> = {
    store: StoreShimmer,
    users: UsersShimmer,
    extension: ExtensionShimmer,
    profile: ProfileShimmer,
    panel: PanelShimmer,
    modChangelog: ModChangelogShimmer,
}

export default function Shimmer({ variant = 'store', className }: ShimmerProps) {
    const VariantComponent = VARIANT_COMPONENTS[variant]

    return (
        <div className={cn(styles.shimmer, styles[`shimmer_${variant}`], className)} aria-hidden="true">
            <VariantComponent />
        </div>
    )
}
