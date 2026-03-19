import React, { useEffect, useMemo, useRef, useState } from 'react'

import {
    AddonConfig,
    Item,
    ButtonItem,
    SliderItem,
    ColorItem,
    FileItem,
    SelectorItem,
    TextItem,
    ButtonAction,
    Section,
} from '@features/configurationSettings/types'

export function produce<S>(state: S, mut: (draft: S) => void): S {
    const copy: S = structuredClone(state as any)
    mut(copy)
    return copy
}

const uid = (prefix = 'id_') => `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

export const ensureStableKeys = (config: AddonConfig): AddonConfig =>
    produce(config, draft => {
        draft.sections.forEach(section => {
            section.items?.forEach(item => {
                ;(item as any).__k ||= uid('k_')
                if (item.type === 'text') {
                    ;(item as TextItem).buttons.forEach(button => ((button as any).__k ||= uid('kb_')))
                }
            })
        })
    })

export const stripInternal = (config: AddonConfig): AddonConfig =>
    produce(config, draft => {
        draft.sections.forEach(section => {
            section.items?.forEach(item => {
                delete (item as any).__k
                if (item.type === 'text') {
                    ;(item as TextItem).buttons.forEach(button => delete (button as any).__k)
                }
            })
        })
    })

const blankItem = (type: Item['type'], t: (key: string, options?: Record<string, any>) => string): Item => {
    switch (type) {
        case 'button':
            return {
                __k: uid('k_') as any,
                id: uid('btn_'),
                name: t('configEditor.defaults.newButton'),
                description: '',
                type: 'button',
                bool: false,
                defaultParameter: false,
            } as any
        case 'slider':
            return {
                __k: uid('k_') as any,
                id: uid('sld_'),
                name: t('configEditor.defaults.newSlider'),
                description: '',
                type: 'slider',
                min: 0,
                max: 100,
                step: 1,
                value: 0,
                defaultParameter: 0,
            } as any
        case 'color':
            return {
                __k: uid('k_') as any,
                id: uid('col_'),
                name: t('configEditor.defaults.newColor'),
                description: '',
                type: 'color',
                input: '#FFFFFFFF',
                defaultParameter: '#FFFFFFFF',
            } as any
        case 'file':
            return {
                __k: uid('k_') as any,
                id: uid('file_'),
                name: t('configEditor.defaults.newFile'),
                description: '',
                type: 'file',
                filePath: '',
                defaultParameter: { filePath: '' },
            } as any
        case 'selector':
            return {
                __k: uid('k_') as any,
                id: uid('sel_'),
                name: t('configEditor.defaults.newSelector'),
                description: '',
                type: 'selector',
                selected: 1,
                options: { '1': { event: 'opt_1', name: t('configEditor.defaults.option', { index: 1 }) } },
                defaultParameter: 1,
            } as any
        case 'text':
        default:
            return {
                __k: uid('k_') as any,
                id: uid('txt_'),
                name: t('configEditor.defaults.newTextBlock'),
                description: '',
                type: 'text',
                buttons: [{ __k: uid('kb_') as any, id: uid('t1_'), name: t('configEditor.defaults.line'), text: '', defaultParameter: '' }] as any,
            } as any
    }
}

export type AddMenuState = { open: false } | { open: true; x: number; y: number; dir: 'down' | 'up'; onPick: (t: Item['type']) => void }

export const typeList: Item['type'][] = ['button', 'slider', 'color', 'file', 'selector', 'text']

type Params = {
    addMenuClassName: string
    configData: AddonConfig
    onChange?: (next: AddonConfig) => void
    save?: (next: AddonConfig) => Promise<void> | void
    configApiSave?: (next: AddonConfig) => Promise<void> | void
    t: (key: string, options?: Record<string, any>) => string
}

export function useConfigurationEditor({ addMenuClassName, configData, onChange, save, configApiSave, t }: Params) {
    const [cfg, setCfg] = useState<AddonConfig>(ensureStableKeys(structuredClone(configData)))
    const baselineRef = useRef<AddonConfig>(ensureStableKeys(structuredClone(configData)))
    const lastSavedSnapRef = useRef<string>(JSON.stringify(stripInternal(configData)))
    const [savedTick, setSavedTick] = useState(0)
    const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
    const [addMenu, setAddMenu] = useState<AddMenuState>({ open: false })
    const dragRef = useRef<{ kind: 'section' | 'item'; fromSi: number; fromIi?: number } | null>(null)
    const [dragOver, setDragOver] = useState<{ si: number; ii?: number; where?: 'before' | 'after' } | null>(null)

    useEffect(() => {
        const incomingClean = stripInternal(structuredClone(configData))
        const incomingSnap = JSON.stringify(incomingClean)
        const isDirtyNow = JSON.stringify(stripInternal(cfg)) !== lastSavedSnapRef.current
        if (!isDirtyNow && incomingSnap !== lastSavedSnapRef.current) {
            const withKeys = ensureStableKeys(structuredClone(configData))
            setCfg(withKeys)
            baselineRef.current = ensureStableKeys(structuredClone(configData))
            lastSavedSnapRef.current = incomingSnap
            setSavedTick(tick => tick + 1)
        }
    }, [cfg, configData])

    const saver = useMemo<undefined | ((c: AddonConfig) => Promise<void> | void)>(() => {
        if (typeof save === 'function') return save
        if (typeof configApiSave === 'function') return configApiSave
        return undefined
    }, [configApiSave, save])

    const setConfig = (next: AddonConfig) => {
        setCfg(next)
        onChange?.(stripInternal(next))
    }

    const isDirty = useMemo(() => JSON.stringify(stripInternal(cfg)) !== lastSavedSnapRef.current, [cfg, savedTick])

    const openAddMenu = (event: React.MouseEvent, onPick: (t: Item['type']) => void) => {
        event.stopPropagation()
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const menuItemHeight = 30
        const menuVerticalPadding = 12
        const menuBorder = 2
        const menuWidth = 260
        const menuHeight = typeList.length * menuItemHeight + menuVerticalPadding + menuBorder
        const gap = 6
        let x = rect.left
        let y = rect.bottom + gap
        let dir: 'down' | 'up' = 'down'

        if (y + menuHeight > window.innerHeight - 8) {
            const up = rect.top - menuHeight - gap
            if (up >= 8) {
                y = up
                dir = 'up'
            }
        }

        x = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8))
        setAddMenu({ open: true, x, y, dir, onPick })
    }

    useEffect(() => {
        if (!addMenu.open) return

        const close = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (!target.closest?.(`.${addMenuClassName}`)) {
                setAddMenu({ open: false })
            }
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setAddMenu({ open: false })
        }
        const onWindowChange = () => setAddMenu({ open: false })

        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', escape)
        window.addEventListener('resize', onWindowChange)
        window.addEventListener('scroll', onWindowChange, true)

        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', escape)
            window.removeEventListener('resize', onWindowChange)
            window.removeEventListener('scroll', onWindowChange, true)
        }
    }, [addMenu])

    const setDragMeta = (event: React.DragEvent, payload: string) => {
        event.dataTransfer.effectAllowed = 'move'
        try {
            event.dataTransfer.setData('text/plain', payload)
        } catch {}
        try {
            event.dataTransfer.setDragImage(event.currentTarget as HTMLElement, 8, 8)
        } catch {}
    }

    const moveSection = (from: number, to: number) =>
        setConfig(
            produce(cfg, draft => {
                const [section] = draft.sections.splice(from, 1)
                draft.sections.splice(to, 0, section)
            }),
        )

    const moveItem = (fromSi: number, fromIi: number, toSi: number, toIndex: number) =>
        setConfig(
            produce(cfg, draft => {
                const [item] = draft.sections[fromSi].items.splice(fromIi, 1)
                draft.sections[toSi].items.splice(toIndex, 0, item)
            }),
        )

    const onSectionDragStart = (si: number) => (event: React.DragEvent) => {
        dragRef.current = { kind: 'section', fromSi: si }
        setDragMeta(event, `section:${si}`)
    }

    const onItemDragStart = (si: number, ii: number) => (event: React.DragEvent) => {
        dragRef.current = { kind: 'item', fromSi: si, fromIi: ii }
        setDragMeta(event, `item:${si}:${ii}`)
    }

    const onDragEnd = () => {
        dragRef.current = null
        setDragOver(null)
    }

    const onItemDragOver = (si: number, ii: number) => (event: React.DragEvent) => {
        if (!dragRef.current || dragRef.current.kind !== 'item') return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        const where: 'before' | 'after' = event.clientY < mid ? 'before' : 'after'
        setDragOver({ si, ii, where })
    }

    const onItemDrop = (si: number, ii: number) => (event: React.DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const drag = dragRef.current
        const where = dragOver?.where
        setDragOver(null)
        dragRef.current = null
        if (!drag || drag.kind !== 'item' || typeof drag.fromIi !== 'number') return
        const targetIndex = where === 'before' ? ii : ii + 1
        if (drag.fromSi === si && drag.fromIi === ii) return
        moveItem(drag.fromSi, drag.fromIi, si, targetIndex > drag.fromIi && drag.fromSi === si ? targetIndex - 1 : targetIndex)
    }

    const onSectionDragOver = (si: number) => (event: React.DragEvent) => {
        if (!dragRef.current) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOver({ si })
    }

    const onSectionDrop = (si: number) => {
        const drag = dragRef.current
        setDragOver(null)
        dragRef.current = null
        if (!drag) return
        if (drag.kind === 'section') {
            if (drag.fromSi === si) return
            moveSection(drag.fromSi, si)
        } else if (typeof drag.fromIi === 'number') {
            moveItem(drag.fromSi, drag.fromIi, si, cfg.sections[si].items.length)
        }
    }

    const getBaselineItem = (si: number, ii: number): Item | undefined => baselineRef.current.sections?.[si]?.items?.[ii]

    const isDirtyEditor = (item: Item, base?: Item): boolean => {
        if (!base || item.type !== base.type) return true
        switch (item.type) {
            case 'button':
                return item.defaultParameter !== (base as ButtonItem).defaultParameter
            case 'slider': {
                const baseSlider = base as SliderItem
                return (
                    item.min !== baseSlider.min ||
                    item.max !== baseSlider.max ||
                    item.step !== baseSlider.step ||
                    item.defaultParameter !== baseSlider.defaultParameter
                )
            }
            case 'color':
                return item.defaultParameter !== (base as ColorItem).defaultParameter
            case 'file':
                return (item.defaultParameter?.filePath ?? '') !== ((base as FileItem).defaultParameter?.filePath ?? '')
            case 'selector': {
                const baseSelector = base as SelectorItem
                const optionsChanged =
                    Object.keys(item.options).length !== Object.keys(baseSelector.options).length ||
                    Object.entries(item.options).some(
                        ([key, option]) =>
                            !baseSelector.options[key] ||
                            baseSelector.options[key].name !== option.name ||
                            baseSelector.options[key].event !== option.event,
                    )
                return String(item.defaultParameter) !== String(baseSelector.defaultParameter) || optionsChanged
            }
            case 'text': {
                const baseText = base as TextItem
                if (item.buttons.length !== baseText.buttons.length) return true
                return item.buttons.some((button, index) => {
                    const baselineButton = baseText.buttons[index]
                    return (
                        button.id !== baselineButton?.id ||
                        button.name !== baselineButton?.name ||
                        (button.defaultParameter ?? '') !== (baselineButton?.defaultParameter ?? '')
                    )
                })
            }
        }
    }

    const resetEditor = (si: number, ii: number) =>
        setConfig(
            produce(cfg, draft => {
                const base = getBaselineItem(si, ii)
                if (!base) {
                    const items = draft.sections?.[si]?.items
                    if (Array.isArray(items)) items.splice(ii, 1)
                    return
                }
                draft.sections[si].items[ii] = structuredClone(base) as Item
            }),
        )

    const addSection = (index?: number) =>
        setConfig(
            produce(cfg, draft => {
                const section: Section = { title: t('configEditor.defaults.newSection'), items: [blankItem('text', t)] }
                if (typeof index === 'number') draft.sections.splice(index, 0, section)
                else draft.sections.push(section)
            }),
        )

    const deleteSection = (si: number) =>
        setConfig(
            produce(cfg, draft => {
                draft.sections.splice(si, 1)
            }),
        )

    const duplicateSection = (si: number) =>
        setConfig(
            produce(cfg, draft => {
                draft.sections.splice(si + 1, 0, structuredClone(draft.sections[si]))
            }),
        )

    const updateItem = (si: number, ii: number, patch: Partial<Item>) =>
        setConfig(
            produce(cfg, draft => {
                Object.assign(draft.sections[si].items[ii], patch)
            }),
        )

    const addItemAt = (si: number, index: number, type: Item['type']) =>
        setConfig(
            produce(cfg, draft => {
                draft.sections[si].items.splice(index, 0, blankItem(type, t))
            }),
        )

    const addItemEnd = (si: number, type: Item['type']) => addItemAt(si, cfg.sections[si].items.length, type)

    const duplicateItem = (si: number, ii: number) =>
        setConfig(
            produce(cfg, draft => {
                const clone = structuredClone(draft.sections[si].items[ii])
                ;(clone as any).__k = uid('k_')
                draft.sections[si].items.splice(ii + 1, 0, clone)
            }),
        )

    const deleteItem = (si: number, ii: number) =>
        setConfig(
            produce(cfg, draft => {
                draft.sections[si].items.splice(ii, 1)
            }),
        )

    const updateTextButton = (si: number, ii: number, bi: number, patch: Partial<ButtonAction>) =>
        setConfig(
            produce(cfg, draft => {
                Object.assign((draft.sections[si].items[ii] as TextItem).buttons[bi], patch)
            }),
        )

    const addTextButton = (si: number, ii: number) =>
        setConfig(
            produce(cfg, draft => {
                ;(draft.sections[si].items[ii] as TextItem).buttons.push({
                    __k: uid('kb_') as any,
                    id: uid('tb_'),
                    name: t('configEditor.defaults.newRow'),
                    text: '',
                    defaultParameter: '',
                } as any)
            }),
        )

    const removeTextButton = (si: number, ii: number, bi: number) =>
        setConfig(
            produce(cfg, draft => {
                ;(draft.sections[si].items[ii] as TextItem).buttons.splice(bi, 1)
            }),
        )

    const addSelectorOption = (si: number, ii: number) =>
        setConfig(
            produce(cfg, draft => {
                const item = draft.sections[si].items[ii] as SelectorItem
                let nextKey = '1'
                const nums = Object.keys(item.options)
                    .map(key => parseInt(key, 10))
                    .filter(x => !isNaN(x))
                if (nums.length) nextKey = String(Math.max(...nums) + 1)
                item.options[nextKey] = { event: `opt_${nextKey}`, name: t('configEditor.defaults.option', { index: nextKey }) }
            }),
        )

    const removeSelectorOption = (si: number, ii: number, key: string) =>
        setConfig(
            produce(cfg, draft => {
                delete (draft.sections[si].items[ii] as SelectorItem).options[key]
            }),
        )

    const resetConfig = () => setCfg(ensureStableKeys(structuredClone(baselineRef.current)))

    const saveConfig = async () => {
        const clean = stripInternal(cfg)
        const snapshot = JSON.stringify(clean)
        if (snapshot === lastSavedSnapRef.current) return
        if (saver) await saver(clean)
        baselineRef.current = ensureStableKeys(structuredClone(cfg))
        lastSavedSnapRef.current = JSON.stringify(stripInternal(baselineRef.current))
        setSavedTick(tick => tick + 1)
    }

    return {
        addItemAt,
        addItemEnd,
        addMenu,
        addSection,
        addSelectorOption,
        addTextButton,
        cfg,
        collapsed,
        deleteItem,
        deleteSection,
        dragOver,
        dragRef,
        duplicateItem,
        duplicateSection,
        getBaselineItem,
        isDirty,
        isDirtyEditor,
        onDragEnd,
        onItemDragOver,
        onItemDragStart,
        onItemDrop,
        onSectionDragOver,
        onSectionDragStart,
        onSectionDrop,
        openAddMenu,
        removeSelectorOption,
        removeTextButton,
        resetConfig,
        resetEditor,
        saveConfig,
        setAddMenu,
        setCfg,
        setCollapsed,
        setConfig,
        updateItem,
        updateTextButton,
    }
}
