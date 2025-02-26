export interface AddonConfig {
    sections: Section[]
}

export interface Section {
    title: string
    items: Item[]
}

export type ItemType = 'button' | 'color' | 'text' | 'slider' | 'file'

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

export interface SliderItem extends ItemBase {
    type: 'slider'
    min: number
    max: number
    step: number
    value: number
    defaultParameter?: number
}

export interface FileItem extends ItemBase {
    type: 'file'
    filePath: string
    defaultParameter?: {
        filePath: string
    }
}


export type Item =
    | ButtonItem
    | ColorItem
    | TextItem
    | SliderItem
    | FileItem

export function isTextItem(item: Item): item is TextItem {
    return item.type === 'text'
}

export function isSliderItem(item: Item): item is SliderItem {
    return item.type === 'slider'
}

export function isFileItem(item: Item): item is FileItem {
    return item.type === 'file'
}
