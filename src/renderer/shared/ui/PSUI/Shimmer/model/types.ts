export type ShimmerVariant = 'store' | 'users' | 'extension' | 'profile' | 'panel' | 'mod-changelog'

export type ShimmerProps = {
    variant?: ShimmerVariant
    className?: string
}
