export type ShimmerVariant = 'store' | 'users' | 'extension' | 'profile' | 'panel' | 'modChangelog'

export type ShimmerProps = {
    variant?: ShimmerVariant
    className?: string
}
