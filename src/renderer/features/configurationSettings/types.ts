export type ButtonAction = {
    id: string
    name: string
    text?: string
    value?: string
    defaultParameter?: string
    defaultValue?: string
}

export type ButtonItem = {
    id: string
    name: string
    description?: string
    type: 'button'
    value: boolean
    defaultValue: boolean
}

export type SliderItem = {
    id: string
    name: string
    description?: string
    type: 'slider'
    min: number
    max: number
    step: number
    value: number
    defaultValue: number
}

export type ColorItem = {
    id: string
    name: string
    description?: string
    type: 'color'
    value: string
    defaultValue: string
}

export type FileItem = {
    id: string
    name: string
    description?: string
    type: 'file'
    value: string
    defaultValue: string
}

export type SelectorItem = {
    id: string
    name: string
    description?: string
    type: 'selector'
    value: number | string
    options: Record<string, { event: string; name: string }>
    defaultValue: number | string
}

export type TextItem = {
    id: string
    name: string
    description?: string
    type: 'text'
    value: string
    defaultValue: string
}

export type Item = ButtonItem | SliderItem | ColorItem | FileItem | SelectorItem | TextItem

export type Section = {
    title: string
    items: Item[]
}

export type AddonConfig = {
    sections: Section[]
}

export type LegacyTextItem = {
    id: string
    name: string
    description?: string
    type: 'text'
    buttons: ButtonAction[]
}

type LegacyButtonItem = {
    id: string
    name: string
    description?: string
    type: 'button'
    bool?: boolean
    value?: boolean
    defaultParameter?: boolean
    defaultValue?: boolean
}

type LegacySliderItem = {
    id: string
    name: string
    description?: string
    type: 'slider'
    min: number
    max: number
    step: number
    value?: number
    defaultParameter?: number
    defaultValue?: number
}

type LegacyColorItem = {
    id: string
    name: string
    description?: string
    type: 'color'
    input?: string
    value?: string
    defaultParameter?: string
    defaultValue?: string
}

type LegacyFileItem = {
    id: string
    name: string
    description?: string
    type: 'file'
    filePath?: string
    value?: string
    defaultParameter?: { filePath?: string } | string
    defaultValue?: string
}

type LegacySelectorItem = {
    id: string
    name: string
    description?: string
    type: 'selector'
    selected?: number | string
    value?: number | string
    options: Record<string, { event: string; name: string }>
    defaultParameter?: number | string
    defaultValue?: number | string
}

type LegacyPlainTextItem = {
    id: string
    name: string
    description?: string
    type: 'text'
    text?: string
    value?: string
    defaultParameter?: string
    defaultValue?: string
}

type NormalizableItem =
    | Item
    | LegacyTextItem
    | LegacyButtonItem
    | LegacySliderItem
    | LegacyColorItem
    | LegacyFileItem
    | LegacySelectorItem
    | LegacyPlainTextItem
type NormalizableSection = {
    title: string
    items: NormalizableItem[]
}

type NormalizableConfig = {
    sections: NormalizableSection[]
}

export const isLegacyTextItem = (item: NormalizableItem): item is LegacyTextItem => {
    return item.type === 'text' && Array.isArray((item as LegacyTextItem).buttons)
}

const getLegacyFileDefaultValue = (item: LegacyFileItem): string => {
    if (typeof item.defaultValue === 'string') return item.defaultValue
    if (typeof item.defaultParameter === 'string') return item.defaultParameter
    if (item.defaultParameter && typeof item.defaultParameter === 'object' && typeof item.defaultParameter.filePath === 'string') {
        return item.defaultParameter.filePath
    }
    return ''
}

const normalizeItem = (item: Exclude<NormalizableItem, LegacyTextItem>): Item => {
    switch (item.type) {
        case 'button': {
            const current = typeof (item as LegacyButtonItem).value === 'boolean' ? (item as LegacyButtonItem).value : (item as LegacyButtonItem).bool
            const fallback = typeof current === 'boolean' ? current : false
            const defaultValue =
                typeof (item as LegacyButtonItem).defaultValue === 'boolean'
                    ? ((item as LegacyButtonItem).defaultValue as boolean)
                    : ((item as LegacyButtonItem).defaultParameter ?? fallback)

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'button',
                value: fallback,
                defaultValue,
            }
        }
        case 'slider': {
            const current = (item as LegacySliderItem).value ?? 0

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'slider',
                min: item.min,
                max: item.max,
                step: item.step,
                value: current,
                defaultValue: (item as LegacySliderItem).defaultValue ?? (item as LegacySliderItem).defaultParameter ?? current,
            }
        }
        case 'color': {
            const current = (item as LegacyColorItem).value ?? (item as LegacyColorItem).input ?? ''

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'color',
                value: current,
                defaultValue: (item as LegacyColorItem).defaultValue ?? (item as LegacyColorItem).defaultParameter ?? current,
            }
        }
        case 'file': {
            const current = (item as LegacyFileItem).value ?? (item as LegacyFileItem).filePath ?? ''
            const legacyDefault = getLegacyFileDefaultValue(item as LegacyFileItem)

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'file',
                value: current,
                defaultValue: legacyDefault || current,
            }
        }
        case 'selector': {
            const current = (item as LegacySelectorItem).value ?? (item as LegacySelectorItem).selected ?? ''

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'selector',
                value: current,
                options: item.options,
                defaultValue: (item as LegacySelectorItem).defaultValue ?? (item as LegacySelectorItem).defaultParameter ?? current,
            }
        }
        case 'text':
        default: {
            const current = (item as LegacyPlainTextItem).value ?? (item as LegacyPlainTextItem).text ?? ''

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                type: 'text',
                value: current,
                defaultValue: (item as LegacyPlainTextItem).defaultValue ?? (item as LegacyPlainTextItem).defaultParameter ?? current,
            }
        }
    }
}

export const normalizeAddonConfig = (config: AddonConfig | NormalizableConfig): AddonConfig => ({
    sections: (config.sections ?? []).map(section => ({
        title: section.title,
        items: (section.items ?? []).flatMap(item => {
            if (!isLegacyTextItem(item)) {
                return [normalizeItem(item)]
            }

            return item.buttons.map((button, index) => ({
                id: button.id || `${item.id}_${index + 1}`,
                name: button.name || item.name,
                description: item.description,
                type: 'text' as const,
                value: String(button.value ?? button.text ?? button.defaultValue ?? button.defaultParameter ?? ''),
                defaultValue: String(button.defaultValue ?? button.defaultParameter ?? button.value ?? button.text ?? ''),
            }))
        }),
    })),
})
