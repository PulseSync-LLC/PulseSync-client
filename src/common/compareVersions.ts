export const compareVersions = (v1: string, v2: string) => {
    const v1parts = v1.split('.').map(Number)
    const v2parts = v2.split('.').map(Number)
    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const a = v1parts[i] || 0
        const b = v2parts[i] || 0
        if (a > b) return 1
        if (a < b) return -1
    }
    return 0
}
