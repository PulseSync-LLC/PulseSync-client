import { Item, TextItem } from '../../../../components/сonfigurationSettings/types'

export const isTextItem = (item: Item): item is TextItem => item.type === 'text'

export const setNestedValue = (obj: any, path: string, value: any): void => {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')

    let current = obj

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        const nextKey = keys[i + 1]

        const isNextKeyIndex = !isNaN(Number(nextKey))

        if (Array.isArray(current)) {
            const index = Number(key)
            if (!current[index]) {
                current[index] = isNextKeyIndex ? [] : {}
            }
            current = current[index]
        } else {
            if (!(key in current) || current[key] === null) {
                current[key] = isNextKeyIndex ? [] : {}
            }
            current = current[key]
        }
    }

    const lastKey = keys.at(-1)!
    if (Array.isArray(current)) {
        current[Number(lastKey)] = value
    } else {
        current[lastKey] = value
    }
}
