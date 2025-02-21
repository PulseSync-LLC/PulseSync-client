export interface AddonConfig {
    sections: Section[]
}

export interface Section {
    title: string
    items: Item[]
}

export type ItemType = 'button' | 'color' | 'text'

export interface ButtonAction {
    id: string
    name: string
    text: string
    defaultParameter?: string
}

export interface ItemBase {
    id: string
    name: string
    description: string
    type: ItemType
}

export interface ButtonItem extends ItemBase {
    type: 'button'
    bool: boolean
    defaultParameter?: boolean
}

export interface ColorItem extends ItemBase {
    type: 'color'
    input: string
    defaultParameter?: string
}

export interface TextItem extends ItemBase {
    type: 'text'
    buttons: ButtonAction[]
}

export type Item = ButtonItem | ColorItem | TextItem

export function isTextItem(item: Item): item is TextItem {
    return item.type === 'text'
}
