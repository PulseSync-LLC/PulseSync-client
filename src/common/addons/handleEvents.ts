export const HANDLE_EVENTS_FILENAME = 'handleEvents.json'
export const HANDLE_EVENTS_SETTINGS_FILENAME = 'pulsesync.settings.json'

export type AddonSettingsValues = Record<string, unknown>

type JsonRecord = Record<string, any>

export interface HandleConfigItem extends JsonRecord {
    id?: string
    type?: string
    bool?: boolean
    filePath?: string
    input?: string
    selected?: number | string
    value?: unknown
    defaultValue?: unknown
    defaultParameter?: unknown
    buttons?: Array<{
        id?: string
        text?: string
        value?: unknown
        defaultParameter?: unknown
        defaultValue?: unknown
    }>
}

export interface HandleConfigSection {
    title?: string
    items?: HandleConfigItem[]
}

export interface HandleConfig {
    sections?: HandleConfigSection[]
}

const hasOwn = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key)
const readConfigId = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const readStoredValue = (storedValues: AddonSettingsValues | undefined, keys: string[]): unknown => {
    if (!storedValues) {
        return undefined
    }

    for (const key of keys) {
        if (key && hasOwn(storedValues, key)) {
            return storedValues[key]
        }
    }

    return undefined
}

const resolveAnonymousTextButtonLegacyKey = (itemId: string, buttonIndex: number): string => (itemId ? `${itemId}_${buttonIndex + 1}` : '')

const resolveTextButtonStorageKey = (
    item: Pick<HandleConfigItem, 'id' | 'type' | 'buttons'>,
    button: { id?: string } | null | undefined,
    buttonIndex: number,
): string => {
    const buttonId = readConfigId(button?.id)
    if (buttonId) {
        return buttonId
    }

    const itemId = readConfigId(item.id)
    if (item.type === 'text' && itemId) {
        return resolveAnonymousTextButtonLegacyKey(itemId, buttonIndex)
    }

    return ''
}

const resolveTextButtonStorageKeys = (
    item: Pick<HandleConfigItem, 'id' | 'type' | 'buttons'>,
    button: { id?: string } | null | undefined,
    buttonIndex: number,
): string[] => {
    const buttonId = readConfigId(button?.id)
    if (buttonId) {
        return [buttonId]
    }

    const itemId = readConfigId(item.id)
    if (item.type !== 'text' || !itemId) {
        return []
    }

    const keys = [resolveAnonymousTextButtonLegacyKey(itemId, buttonIndex)]
    if (Array.isArray(item.buttons) && item.buttons.length === 1 && buttonIndex === 0) {
        keys.unshift(itemId)
    }

    return Array.from(new Set(keys.filter(Boolean)))
}

const extractTextButtonValue = (button: { value?: unknown; text?: string } | null | undefined): unknown => {
    if (typeof button?.value !== 'undefined') {
        return button.value
    }

    return button?.text
}

export const normalizeAddonSettingsValues = (input: unknown): AddonSettingsValues => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {}
    }

    return Object.entries(input as Record<string, unknown>).reduce(
        (acc, [key, value]) => {
            const normalizedKey = String(key || '').trim()
            if (normalizedKey) {
                acc[normalizedKey] = value
            }
            return acc
        },
        {} as AddonSettingsValues,
    )
}

export const extractHandleConfigItemValue = (item: HandleConfigItem, storedValues?: AddonSettingsValues): unknown => {
    if (item.id) {
        const storedValue = readStoredValue(storedValues, [item.id])
        if (typeof storedValue !== 'undefined') {
            return storedValue
        }
    }

    if (typeof item.value !== 'undefined') return item.value
    if (typeof item.bool !== 'undefined') return item.bool
    if (typeof item.filePath !== 'undefined') return item.filePath
    if (typeof item.input !== 'undefined') return item.input
    if (typeof item.selected !== 'undefined') return item.selected
    if (typeof (item as Record<string, unknown>).text !== 'undefined') return (item as Record<string, unknown>).text

    return undefined
}

export const extractHandleConfigItemDefaultValue = (item: HandleConfigItem): unknown => {
    if (typeof item.defaultValue !== 'undefined') return item.defaultValue

    if (typeof item.defaultParameter !== 'undefined') {
        if (item.type === 'file' && item.defaultParameter && typeof item.defaultParameter === 'object' && 'filePath' in item.defaultParameter) {
            return (item.defaultParameter as { filePath?: string }).filePath ?? ''
        }

        return item.defaultParameter
    }

    return undefined
}

export const collectAddonSettingsValuesFromConfig = (
    input: { sections?: Array<{ items?: Array<Record<string, any>> }> } | null | undefined,
): AddonSettingsValues => {
    const result: AddonSettingsValues = {}

    if (!Array.isArray(input?.sections)) {
        return result
    }

    for (const section of input.sections) {
        if (!Array.isArray(section?.items)) continue

        for (const item of section.items) {
            if (item?.type === 'text' && Array.isArray(item.buttons)) {
                for (const [buttonIndex, button] of item.buttons.entries()) {
                    const storageKey = resolveTextButtonStorageKey(item as HandleConfigItem, button, buttonIndex)
                    if (!storageKey) continue

                    const value = extractTextButtonValue(button)
                    if (typeof value !== 'undefined') {
                        result[storageKey] = value
                    }
                }

                continue
            }

            if (!item?.id || typeof item.id !== 'string') continue

            const value = extractHandleConfigItemValue(item as HandleConfigItem)
            if (typeof value !== 'undefined') {
                result[item.id] = value
            }
        }
    }

    return result
}

export const applyAddonSettingsValuesToConfig = <T extends { sections?: Array<{ items?: Array<Record<string, any>> }> }>(
    input: T,
    storedValues?: AddonSettingsValues,
): T => {
    const normalizedValues = normalizeAddonSettingsValues(storedValues)
    if (!Array.isArray(input?.sections) || Object.keys(normalizedValues).length === 0) {
        return input
    }

    return {
        ...input,
        sections: input.sections.map(section => ({
            ...section,
            items: Array.isArray(section?.items)
                ? section.items.map(item => {
                      if (!item || typeof item !== 'object') {
                          return item
                      }

                      if (item.type === 'text' && Array.isArray(item.buttons)) {
                          return {
                              ...item,
                              buttons: item.buttons.map((button, buttonIndex) => {
                                  const storageKeys = resolveTextButtonStorageKeys(item as HandleConfigItem, button, buttonIndex)
                                  const nextValue = readStoredValue(normalizedValues, storageKeys)
                                  if (typeof nextValue === 'undefined') {
                                      return button
                                  }

                                  return {
                                      ...button,
                                      value: nextValue,
                                      ...(typeof nextValue === 'string' ? { text: nextValue } : {}),
                                  }
                              }),
                          }
                      }

                      if (!item?.id || typeof item.id !== 'string' || !hasOwn(normalizedValues, item.id)) {
                          return item
                      }

                      const nextValue = normalizedValues[item.id]
                      const nextItem: Record<string, any> = {
                          ...item,
                          value: nextValue,
                      }

                      switch (item.type) {
                          case 'button':
                              nextItem.bool = nextValue
                              break
                          case 'color':
                              nextItem.input = typeof nextValue === 'string' ? nextValue : String(nextValue ?? '')
                              break
                          case 'file':
                              nextItem.filePath = typeof nextValue === 'string' ? nextValue : String(nextValue ?? '')
                              break
                          case 'selector':
                              nextItem.selected = nextValue
                              break
                          case 'text':
                              nextItem.text = typeof nextValue === 'string' ? nextValue : String(nextValue ?? '')
                              break
                      }

                      return nextItem
                  })
                : [],
        })),
    }
}
