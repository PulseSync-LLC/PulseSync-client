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
    buttons: ButtonAction[]
}

export type Item = ButtonItem | SliderItem | ColorItem | FileItem | SelectorItem | TextItem

export type Section = {
    title: string
    items: Item[]
}

export type AddonConfig = {
    sections: Section[]
}
