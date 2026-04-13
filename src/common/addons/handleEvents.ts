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
    if (item.id && storedValues && hasOwn(storedValues, item.id)) {
        return storedValues[item.id]
    }

    if (typeof item.value !== 'undefined') return item.value
    if (typeof item.bool !== 'undefined') return item.bool
    if (typeof item.filePath !== 'undefined') return item.filePath
    if (typeof item.input !== 'undefined') return item.input
    if (typeof item.selected !== 'undefined') return item.selected

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
                for (const button of item.buttons) {
                    if (!button?.id || typeof button.id !== 'string') continue

                    const value = typeof button.value !== 'undefined' ? button.value : button.text
                    if (typeof value !== 'undefined') {
                        result[button.id] = value
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
                              buttons: item.buttons.map(button => {
                                  if (!button?.id || typeof button.id !== 'string' || !hasOwn(normalizedValues, button.id)) {
                                      return button
                                  }

                                  return {
                                      ...button,
                                      value: normalizedValues[button.id],
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
