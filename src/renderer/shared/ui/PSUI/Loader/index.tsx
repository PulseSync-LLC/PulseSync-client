import Shimmer, { type ShimmerVariant } from '@shared/ui/PSUI/Shimmer'

export default function Loader({ variant = 'store' }: { variant?: ShimmerVariant }) {
    return <Shimmer variant={variant} />
}
