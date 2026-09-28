type ActiveComponent = { version: string; path: string; sha256: string }

let cached: Record<string, ActiveComponent> | null = null

export function getActiveComponentPath(name: string): string | null {
    if (!cached) {
        try {
            cached = JSON.parse(process.env.PULSESYNC_ACTIVE_COMPONENTS_JSON || '{}') as Record<string, ActiveComponent>
        } catch {
            cached = {}
        }
    }
    const component = cached[name]
    return component && typeof component.path === 'string' ? component.path : null
}
