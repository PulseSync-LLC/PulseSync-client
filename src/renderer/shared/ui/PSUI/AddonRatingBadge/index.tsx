import { Badge } from '@pulsesync/uikit/data-display'
import cn from 'clsx'
import { MdStar } from 'react-icons/md'

import * as st from '@shared/ui/PSUI/AddonRatingBadge/AddonRatingBadge.module.scss'

type AddonRatingBadgeProps = {
    average: number
    className?: string
}

export default function AddonRatingBadge({ average, className }: AddonRatingBadgeProps) {
    if (average <= 0) return null

    return (
        <Badge uppercase={false} size="md" icon={<MdStar />} className={cn(st.badge, className)}>
            {average.toFixed(1)}
        </Badge>
    )
}
