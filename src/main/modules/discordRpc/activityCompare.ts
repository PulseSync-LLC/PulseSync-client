import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'

function deepClone<T>(obj: T): T {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj))
}

function sortKeys(value: any): any {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {}
        for (const k of Object.keys(value).sort()) out[k] = sortKeys((value as any)[k])
        return out
    }
    return value
}

function normalizeActivityForCompare(activity: any) {
    const copy = deepClone(activity) || {}
    if (copy.startTimestamp) copy.startTimestamp = 0
    if (copy.endTimestamp) copy.endTimestamp = 0
    return sortKeys(copy)
}

function isTimestampsDifferent(activityA: any, activityB: any) {
    const aStart = activityA?.startTimestamp ?? 0
    const bStart = activityB?.startTimestamp ?? 0
    const aEnd = activityA?.endTimestamp ?? 0
    const bEnd = activityB?.endTimestamp ?? 0
    const diff = Math.abs(aStart - bStart) + Math.abs(aEnd - bEnd)
    return diff >= 2000
}

export function compareActivities(previousActivity: SetActivity | undefined, newActivity: any) {
    if (!previousActivity) return false
    const a = JSON.stringify(normalizeActivityForCompare(newActivity))
    const b = JSON.stringify(normalizeActivityForCompare(previousActivity))
    return a === b && !isTimestampsDifferent(newActivity, previousActivity)
}
