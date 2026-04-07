export type ButtonAction = {
    id: string
    name: string
    text: string
    defaultParameter?: string
}

export type ButtonItem = {
    id: string
    name: string
    description?: string
    type: 'button'
    bool: boolean
    defaultParameter: boolean
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
    defaultParameter: number
}

export type ColorItem = {
    id: string
    name: string
    description?: string
    type: 'color'
    input: string
    defaultParameter: string
}

export type FileItem = {
    id: string
    name: string
    description?: string
    type: 'file'
    filePath: string
    defaultParameter?: { filePath: string }
}

export type SelectorItem = {
    id: string
    name: string
    description?: string
    type: 'selector'
    selected: number | string
    options: Record<string, { event: string; name: string }>
    defaultParameter: number | string
}

export type TextItem = {
    id: string
    name: string
    description?: string
    type: 'text'
    text: string
    defaultParameter: string
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

type NormalizableItem = Item | LegacyTextItem
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

export const normalizeAddonConfig = (config: AddonConfig | NormalizableConfig): AddonConfig => ({
    sections: (config.sections ?? []).map(section => ({
        title: section.title,
        items: (section.items ?? []).flatMap(item => {
            if (!isLegacyTextItem(item)) {
                return [item as Item]
            }

            return item.buttons.map((button, index) => ({
                id: button.id || `${item.id}_${index + 1}`,
                name: button.name || item.name,
                description: item.description,
                type: 'text' as const,
                text: String(button.text ?? button.defaultParameter ?? ''),
                defaultParameter: String(button.defaultParameter ?? button.text ?? ''),
            }))
        }),
    })),
})
