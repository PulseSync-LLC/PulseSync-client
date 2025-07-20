export interface AddonConfig {
    [x: string]: any
    sections: Section[]
}

export interface Section {
    title: string
    items: Item[]
}

export type ItemType = 'button' | 'color' | 'text' | 'slider' | 'file' | 'selector'

// ------------ Общая структура кнопки ------------
export interface ButtonAction {
    id: string
    name: string
    text: string
    defaultParameter?: string
}

// ------------ Базовый интерфейс для любого Item ------------
export interface ItemBase {
    id: string
    name: string
    description: string
    type: ItemType
}

// ------------ Типы Items ------------
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

export interface SelectorOptionsMap {
    [key: string]: {
        event: string
        name: string
    }
}

export interface SelectorItem extends ItemBase {
    type: 'selector'
    selected: number
    options: SelectorOptionsMap
    defaultParameter?: number
}

// ------------ Union всех Item ------------
export type Item = ButtonItem | ColorItem | TextItem | SliderItem | FileItem | SelectorItem

// ------------ Помощники для определения типа ------------
export function isTextItem(item: Item): item is TextItem {
    return item.type === 'text'
}

export function isSliderItem(item: Item): item is SliderItem {
    return item.type === 'slider'
}

export function isFileItem(item: Item): item is FileItem {
    return item.type === 'file'
}

/** Для проверки, является ли Item селектором */
export function isSelectorItem(item: Item): item is SelectorItem {
    return item.type === 'selector'
}
