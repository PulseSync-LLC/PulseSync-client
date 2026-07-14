export function getDesktopErrorTrackingRelease(version: string, commit: string): string {
    return `pulsesync-desktop@${version}-${commit}`
}

export function getRendererErrorTrackingRelease(buildNumber: string): string {
    return `pulsesync-renderer@${buildNumber}`
}
