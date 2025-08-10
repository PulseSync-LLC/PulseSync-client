import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AddonConfig, Item, ButtonItem, SliderItem, ColorItem, FileItem, SelectorItem, TextItem, ButtonAction, Section } from './types'

import ButtonInput from '../PSUI/ButtonInput'
import TextInput from '../PSUI/TextInput'
import ColorInput from '../PSUI/ColorInput'
import SelectInput from '../PSUI/SelectInput'
import SliderInput from '../PSUI/SliderInput'
import FileInput from '../PSUI/FileInput'

import { MdDragIndicator, MdContentCopy, MdDelete, MdAdd, MdUnfoldMore, MdUnfoldLess, MdAddCircleOutline } from 'react-icons/md'
import * as css from './ConfigurationSettingsEdit.module.scss'
import ChangesBar from '../PSUI/ChangesBar'

type Props = {
    configData: AddonConfig
    onChange?: (next: AddonConfig) => void
    save?: (next: AddonConfig) => Promise<void> | void
    filePreviewSrc?: (p: string) => string
} & Record<string, any>

function produce<S>(state: S, mut: (draft: S) => void): S {
    const copy: S = structuredClone(state as any)
    mut(copy)
    return copy
}

const uid = (p = 'id_') => `${p}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

const ensureStableKeys = (c: AddonConfig): AddonConfig =>
    produce(c, d => {
        d.sections.forEach(s => {
            s.items?.forEach(it => {
                ;(it as any).__k ||= uid('k_')
                if (it.type === 'text') {
                    ;(it as TextItem).buttons.forEach(b => ((b as any).__k ||= uid('kb_')))
                }
            })
        })
    })

const stripInternal = (c: AddonConfig): AddonConfig =>
    produce(c, d => {
        d.sections.forEach(s => {
            s.items?.forEach(it => {
                delete (it as any).__k
                if (it.type === 'text') (it as TextItem).buttons.forEach(b => delete (b as any).__k)
            })
        })
    })

const blankItem = (type: Item['type']): Item => {
    switch (type) {
        case 'button':
            return {
                __k: uid('k_') as any,
                id: uid('btn_'),
                name: 'Новая кнопка',
                description: '',
                type: 'button',
                bool: false,
                defaultParameter: false,
            } as any
        case 'slider':
            return {
                __k: uid('k_') as any,
                id: uid('sld_'),
                name: 'Новый слайдер',
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
                name: 'Новый цвет',
                description: '',
                type: 'color',
                input: '#FFFFFFFF',
                defaultParameter: '#FFFFFFFF',
            } as any
        case 'file':
            return {
                __k: uid('k_') as any,
                id: uid('file_'),
                name: 'Новый файл',
                description: '',
                type: 'file',
                filePath: '',
                defaultParameter: { filePath: '' },
            } as any
        case 'selector':
            return {
                __k: uid('k_') as any,
                id: uid('sel_'),
                name: 'Новый селектор',
                description: '',
                type: 'selector',
                selected: 1,
                options: { '1': { event: 'opt_1', name: 'Опция 1' } },
                defaultParameter: 1,
            } as any
        case 'text':
        default:
            return {
                __k: uid('k_') as any,
                id: uid('txt_'),
                name: 'Новый текстовый блок',
                description: '',
                type: 'text',
                buttons: [{ __k: uid('kb_') as any, id: uid('t1_'), name: 'Строка', text: '', defaultParameter: '' }] as any,
            } as any
    }
}

type AddMenuState = { open: false } | { open: true; x: number; y: number; dir: 'down' | 'up'; onPick: (t: Item['type']) => void }

const typeList: Item['type'][] = ['button', 'slider', 'color', 'file', 'selector', 'text']

const ConfigurationSettingsEdit: React.FC<Props> = ({ configData, onChange, save, filePreviewSrc, ...rest }) => {
    const [cfg, setCfg] = useState<AddonConfig>(ensureStableKeys(structuredClone(configData)))

    const baselineRef = useRef<AddonConfig>(ensureStableKeys(structuredClone(configData)))
    const lastSavedSnapRef = useRef<string>(JSON.stringify(stripInternal(configData)))

    const [savedTick, setSavedTick] = useState(0)
    const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

    useEffect(() => {
        const incomingClean = stripInternal(structuredClone(configData))
        const incomingSnap = JSON.stringify(incomingClean)
        const isDirtyNow = JSON.stringify(stripInternal(cfg)) !== lastSavedSnapRef.current
        if (!isDirtyNow && incomingSnap !== lastSavedSnapRef.current) {
            const withKeys = ensureStableKeys(structuredClone(configData))
            setCfg(withKeys)
            baselineRef.current = ensureStableKeys(structuredClone(configData))
            lastSavedSnapRef.current = incomingSnap
            setSavedTick(t => t + 1)
        }
    }, [configData])

    const saver = useMemo<undefined | ((c: AddonConfig) => Promise<void> | void)>(() => {
        if (typeof save === 'function') return save
        if (rest?.configApi && typeof rest.configApi.save === 'function') return rest.configApi.save
        return undefined
    }, [save, rest])

    const setConfig = (next: AddonConfig) => {
        setCfg(next)
        onChange?.(stripInternal(next))
    }

    const isDirty = useMemo(() => JSON.stringify(stripInternal(cfg)) !== lastSavedSnapRef.current, [cfg, savedTick])

    const rootRef = useRef<HTMLDivElement | null>(null)

    const [addMenu, setAddMenu] = useState<AddMenuState>({ open: false })
    const openAddMenu = (e: React.MouseEvent, onPick: (t: Item['type']) => void) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const MENU_ITEM_H = 30,
            MENU_VPAD = 12,
            MENU_BORDER = 2,
            MENU_W = 260
        const MENU_H = typeList.length * MENU_ITEM_H + MENU_VPAD + MENU_BORDER
        const gap = 6
        let x = rect.left,
            y = rect.bottom + gap,
            dir: 'down' | 'up' = 'down'
        if (y + MENU_H > window.innerHeight - 8) {
            const up = rect.top - MENU_H - gap
            if (up >= 8) {
                y = up
                dir = 'up'
            }
        }
        x = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8))
        setAddMenu({ open: true, x, y, dir, onPick })
    }

    useEffect(() => {
        if (!addMenu.open) return
        const close = (ev: MouseEvent) => {
            const tgt = ev.target as HTMLElement
            if (!tgt.closest?.(`.${css.addMenu}`)) setAddMenu({ open: false })
        }
        const escape = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') setAddMenu({ open: false })
        }
        const onWinChange = () => setAddMenu({ open: false })
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', escape)
        window.addEventListener('resize', onWinChange)
        window.addEventListener('scroll', onWinChange, true)
        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', escape)
            window.removeEventListener('resize', onWinChange)
            window.removeEventListener('scroll', onWinChange, true)
        }
    }, [addMenu])

    const dragRef = useRef<{ kind: 'section' | 'item'; fromSi: number; fromIi?: number } | null>(null)
    const [dragOver, setDragOver] = useState<{ si: number; ii?: number; where?: 'before' | 'after' } | null>(null)

    const setDragMeta = (e: React.DragEvent, payload: string) => {
        e.dataTransfer.effectAllowed = 'move'
        try {
            e.dataTransfer.setData('text/plain', payload)
        } catch {}
        try {
            e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, 8, 8)
        } catch {}
    }

    const onSectionDragStart = (si: number) => (e: React.DragEvent) => {
        dragRef.current = { kind: 'section', fromSi: si }
        setDragMeta(e, `section:${si}`)
    }
    const onItemDragStart = (si: number, ii: number) => (e: React.DragEvent) => {
        dragRef.current = { kind: 'item', fromSi: si, fromIi: ii }
        setDragMeta(e, `item:${si}:${ii}`)
    }
    const onDragEnd = () => {
        dragRef.current = null
        setDragOver(null)
    }

    const onItemDragOver = (si: number, ii: number) => (e: React.DragEvent) => {
        if (!dragRef.current || dragRef.current.kind !== 'item') return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        const where: 'before' | 'after' = e.clientY < mid ? 'before' : 'after'
        setDragOver({ si, ii, where })
    }

    const onItemDrop = (si: number, ii: number) => (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const drag = dragRef.current
        const where = dragOver?.where
        setDragOver(null)
        dragRef.current = null
        if (!drag || drag.kind !== 'item' || typeof drag.fromIi !== 'number') return
        const targetIndex = where === 'before' ? ii : ii + 1
        if (drag.fromSi === si && drag.fromIi === ii) return
        moveItem(drag.fromSi, drag.fromIi, si, targetIndex > drag.fromIi && drag.fromSi === si ? targetIndex - 1 : targetIndex)
    }

    const onSectionDragOver = (si: number) => (e: React.DragEvent) => {
        if (!dragRef.current) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
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
                const b = base as SliderItem
                return item.min !== b.min || item.max !== b.max || item.step !== b.step || item.defaultParameter !== b.defaultParameter
            }
            case 'color':
                return item.defaultParameter !== (base as ColorItem).defaultParameter
            case 'file':
                return (item.defaultParameter?.filePath ?? '') !== ((base as FileItem).defaultParameter?.filePath ?? '')
            case 'selector': {
                const b = base as SelectorItem
                const optsChanged =
                    Object.keys(item.options).length !== Object.keys(b.options).length ||
                    Object.entries(item.options).some(([k, o]) => !b.options[k] || b.options[k].name !== o.name || b.options[k].event !== o.event)
                return String(item.defaultParameter) !== String(b.defaultParameter) || optsChanged
            }
            case 'text': {
                const b = base as TextItem
                if (item.buttons.length !== b.buttons.length) return true
                return item.buttons.some((x, i) => {
                    const y = b.buttons[i]
                    return x.id !== y?.id || x.name !== y?.name || (x.defaultParameter ?? '') !== (y?.defaultParameter ?? '')
                })
            }
        }
    }

    const resetEditor = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                const base = getBaselineItem(si, ii)
                if (!base) {
                    const arr = d.sections?.[si]?.items
                    if (Array.isArray(arr)) arr.splice(ii, 1)
                    return
                }
                d.sections[si].items[ii] = structuredClone(base) as Item
            }),
        )

    const addSection = (index?: number) =>
        setConfig(
            produce(cfg, d => {
                const s: Section = { title: 'Новая секция', items: [blankItem('text')] }
                if (typeof index === 'number') d.sections.splice(index, 0, s)
                else d.sections.push(s)
            }),
        )

    const deleteSection = (si: number) =>
        setConfig(
            produce(cfg, d => {
                d.sections.splice(si, 1)
            }),
        )

    const duplicateSection = (si: number) =>
        setConfig(
            produce(cfg, d => {
                d.sections.splice(si + 1, 0, structuredClone(d.sections[si]))
            }),
        )

    const moveSection = (from: number, to: number) =>
        setConfig(
            produce(cfg, d => {
                const [s] = d.sections.splice(from, 1)
                d.sections.splice(to, 0, s)
            }),
        )

    const updateItem = (si: number, ii: number, patch: Partial<Item>) =>
        setConfig(
            produce(cfg, d => {
                Object.assign(d.sections[si].items[ii], patch)
            }),
        )

    const addItemAt = (si: number, index: number, type: Item['type']) =>
        setConfig(
            produce(cfg, d => {
                d.sections[si].items.splice(index, 0, blankItem(type))
            }),
        )

    const addItemEnd = (si: number, type: Item['type']) => addItemAt(si, cfg.sections[si].items.length, type)

    const duplicateItem = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                const clone = structuredClone(d.sections[si].items[ii])
                ;(clone as any).__k = uid('k_')
                d.sections[si].items.splice(ii + 1, 0, clone)
            }),
        )

    const deleteItem = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                d.sections[si].items.splice(ii, 1)
            }),
        )

    const moveItem = (fromSi: number, fromIi: number, toSi: number, toIndex: number) =>
        setConfig(
            produce(cfg, d => {
                const [it] = d.sections[fromSi].items.splice(fromIi, 1)
                d.sections[toSi].items.splice(toIndex, 0, it)
            }),
        )

    const updateTextButton = (si: number, ii: number, bi: number, patch: Partial<ButtonAction>) =>
        setConfig(
            produce(cfg, d => {
                Object.assign((d.sections[si].items[ii] as TextItem).buttons[bi], patch)
            }),
        )

    const addTextButton = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                ;(d.sections[si].items[ii] as any as TextItem).buttons.push({
                    __k: uid('kb_') as any,
                    id: uid('tb_'),
                    name: 'Новая строка',
                    text: '',
                    defaultParameter: '',
                } as any)
            }),
        )

    const removeTextButton = (si: number, ii: number, bi: number) =>
        setConfig(
            produce(cfg, d => {
                ;(d.sections[si].items[ii] as TextItem).buttons.splice(bi, 1)
            }),
        )

    const addSelectorOption = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                const it = d.sections[si].items[ii] as SelectorItem
                let nextKey = '1'
                const nums = Object.keys(it.options)
                    .map(k => parseInt(k, 10))
                    .filter(x => !isNaN(x))
                if (nums.length) nextKey = String(Math.max(...nums) + 1)
                it.options[nextKey] = { event: `opt_${nextKey}`, name: `Опция ${nextKey}` }
            }),
        )

    const removeSelectorOption = (si: number, ii: number, key: string) =>
        setConfig(
            produce(cfg, d => {
                delete (d.sections[si].items[ii] as SelectorItem).options[key]
            }),
        )

    const renderItemBody = (si: number, ii: number, item: Item) => {
        switch (item.type) {
            case 'button': {
                const it = item as ButtonItem
                return (
                    <ButtonInput
                        label={`${it.name} — default`}
                        defaultValue={it.defaultParameter}
                        checkType={`config-default-${it.id}`}
                        onChange={(val: boolean) => updateItem(si, ii, { defaultParameter: val })}
                    />
                )
            }
            case 'color': {
                const it = item as ColorItem
                return (
                    <ColorInput
                        label={`${it.name} — default`}
                        value={it.defaultParameter}
                        onChange={val => updateItem(si, ii, { defaultParameter: val })}
                        withAlpha={true}
                        inputModes={['hex', 'rgb', 'hsl', 'hsb']}
                        defaultMode="hex"
                    />
                )
            }
            case 'selector': {
                const it = item as SelectorItem
                const opts = Object.entries(it.options).map(([k, o]) => ({ value: k, label: o.name }))
                const toNumber = typeof it.defaultParameter === 'number'
                return (
                    <>
                        <SelectInput
                            label={`${it.name} — default`}
                            value={String(it.defaultParameter)}
                            options={opts}
                            onChange={val => updateItem(si, ii, { defaultParameter: toNumber ? Number(val) : (String(val) as any) })}
                        />
                        <div className={css.smallTitle}>Опции</div>
                        <div className={css.table}>
                            {Object.entries(it.options).map(([k, o]) => (
                                <div key={k} className={css.tableRow}>
                                    <TextInput
                                        name={`opt_key_${k}`}
                                        label="key"
                                        value={k}
                                        onChange={v =>
                                            setConfig(
                                                produce(cfg, d => {
                                                    const obj = (d.sections[si].items[ii] as SelectorItem).options
                                                    const val = obj[k]
                                                    delete obj[k]
                                                    obj[String(v || k)] = val
                                                }),
                                            )
                                        }
                                    />
                                    <TextInput
                                        name={`opt_name_${k}`}
                                        label="name"
                                        value={o.name}
                                        onChange={v =>
                                            setConfig(
                                                produce(cfg, d => {
                                                    ;(d.sections[si].items[ii] as SelectorItem).options[k].name = v
                                                }),
                                            )
                                        }
                                    />
                                    <TextInput
                                        name={`opt_evt_${k}`}
                                        label="event"
                                        value={o.event}
                                        onChange={v =>
                                            setConfig(
                                                produce(cfg, d => {
                                                    ;(d.sections[si].items[ii] as SelectorItem).options[k].event = v
                                                }),
                                            )
                                        }
                                    />
                                    <button className={css.iconBtn} title="Удалить опцию" onClick={() => removeSelectorOption(si, ii, k)}>
                                        <MdDelete size={18} />
                                    </button>
                                </div>
                            ))}
                            <div className={css.rowEnd}>
                                <button className={css.addBtn} onClick={() => addSelectorOption(si, ii)}>
                                    <MdAdd /> Добавить опцию
                                </button>
                            </div>
                        </div>
                    </>
                )
            }
            case 'slider': {
                const it = item as SliderItem
                const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
                return (
                    <>
                        <div className={css.inlineGrid}>
                            <TextInput
                                name={`${it.id}_min`}
                                label="Min"
                                value={String(it.min)}
                                onChange={t => {
                                    const n = Number(t) || 0
                                    const max = Math.max(n, it.max)
                                    updateItem(si, ii, { min: n, max, defaultParameter: clamp(it.defaultParameter, n, max) })
                                }}
                            />
                            <TextInput
                                name={`${it.id}_max`}
                                label="Max"
                                value={String(it.max)}
                                onChange={t => {
                                    const n = Number(t) || 0
                                    const min = Math.min(it.min, n)
                                    updateItem(si, ii, { max: n, min, defaultParameter: clamp(it.defaultParameter, min, n) })
                                }}
                            />
                            <TextInput
                                name={`${it.id}_step`}
                                label="Step"
                                value={String(it.step)}
                                onChange={t => updateItem(si, ii, { step: Math.max(1, Number(t) || 1) })}
                            />
                        </div>

                        <SliderInput
                            label={`${it.name} — default`}
                            min={it.min}
                            max={it.max}
                            step={it.step}
                            value={it.defaultParameter}
                            onChange={val => updateItem(si, ii, { defaultParameter: val })}
                        />
                    </>
                )
            }
            case 'file': {
                const it = item as FileItem
                const def = it.defaultParameter?.filePath ?? ''
                return (
                    <FileInput
                        label={`${it.name} — default`}
                        value={def}
                        onChange={p => updateItem(si, ii, { defaultParameter: { filePath: p } as any })}
                        previewSrc={filePreviewSrc}
                        placeholder="Укажите путь"
                    />
                )
            }
            case 'text': {
                const it = item as TextItem
                return (
                    <>
                        <div className={clsx(css.smallTitle)}>{it.name}</div>
                        {it.buttons.map((b, bi) => (
                            <div key={(b as any).__k} className={css.list}>
                                <div className={css.inlineGrid}>
                                    <TextInput
                                        name={`btn_name_${b.id}`}
                                        label="Название"
                                        value={b.name}
                                        onChange={v => updateTextButton(si, ii, bi, { name: v })}
                                    />
                                    <TextInput
                                        name={`btn_id_${b.id}`}
                                        label="ID"
                                        value={b.id}
                                        onChange={v => updateTextButton(si, ii, bi, { id: v })}
                                    />
                                </div>
                                <div className={css.rowWithDelete}>
                                    <TextInput
                                        name={`btn_def_${b.id}`}
                                        label="Default"
                                        value={b.defaultParameter ?? ''}
                                        onChange={v => updateTextButton(si, ii, bi, { defaultParameter: v })}
                                    />
                                    <button
                                        className={clsx(css.iconBtn, css.dangerBtn)}
                                        title="Удалить строку"
                                        onClick={() => removeTextButton(si, ii, bi)}
                                    >
                                        <MdDelete />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <div className={css.rowEnd}>
                            <button className={css.addBtn} onClick={() => addTextButton(si, ii)}>
                                <MdAdd /> Добавить строку
                            </button>
                        </div>
                    </>
                )
            }
            default:
                return (
                    <div className={css.placeholder}>
                        <div className={css.phTitle}>Компонент в переработке</div>
                        <div className={css.phHint}>Скоро будет доступен.</div>
                    </div>
                )
        }
    }

    const renderItem = (si: number, ii: number, item: Item) => {
        const base = getBaselineItem(si, ii)
        const dirty = isDirtyEditor(item, base)
        const dropBefore = dragOver && dragOver.si === si && dragOver.ii === ii && dragOver.where === 'before'
        const dropAfter = dragOver && dragOver.si === si && dragOver.ii === ii && dragOver.where === 'after'

        return (
            <div
                key={(item as any).__k}
                className={clsx(css.item, dropBefore && css.dropBefore, dropAfter && css.dropAfter)}
                onDragOver={onItemDragOver(si, ii)}
                onDrop={onItemDrop(si, ii)}
            >
                <div className={css.itemHeader}>
                    <span className={css.handle} title="Перетащить" draggable onDragStart={onItemDragStart(si, ii)} onDragEnd={onDragEnd}>
                        <MdDragIndicator />
                    </span>

                    <div className={css.metaGrid}>
                        <TextInput
                            name={`item_name_${item.id}`}
                            label="Название"
                            value={item.name}
                            onChange={v => updateItem(si, ii, { name: v } as Partial<Item>)}
                        />
                        <TextInput
                            name={`item_id_${item.id}`}
                            label="ID"
                            value={item.id}
                            onChange={v => updateItem(si, ii, { id: v } as Partial<Item>)}
                        />
                    </div>

                    <div className={css.tools}>
                        <button
                            className={css.iconBtn}
                            title="Добавить элемент после"
                            onClick={e =>
                                openAddMenu(e, (t: Item['type']) => {
                                    setAddMenu({ open: false })
                                    addItemAt(si, ii + 1, t)
                                })
                            }
                        >
                            <MdAddCircleOutline size={18} />
                        </button>

                        <button className={css.iconBtn} title="Дублировать" onClick={() => duplicateItem(si, ii)}>
                            <MdContentCopy size={18} />
                        </button>
                        {base && dirty && (
                            <button className={clsx(css.iconBtn, css.warnBtn)} title="Сбросить к эталону" onClick={() => resetEditor(si, ii)}>
                                ↺
                            </button>
                        )}
                        <button className={clsx(css.iconBtn, css.dangerBtn)} title="Удалить" onClick={() => deleteItem(si, ii)}>
                            <MdDelete size={18} />
                        </button>
                    </div>
                </div>

                <TextInput
                    name={`item_desc_${item.id}`}
                    label="Описание"
                    value={item.description ?? ''}
                    onChange={v => updateItem(si, ii, { description: v } as Partial<Item>)}
                />

                <div className={css.body}>{renderItemBody(si, ii, item)}</div>
            </div>
        )
    }

    return (
        <div ref={rootRef} className={css.root}>
            <div className={css.topBar}>
                <button className={css.addBtn} onClick={() => addSection()}>
                    <MdAdd /> Добавить секцию
                </button>
                <div className={css.rightBtns}>
                    <button className={css.iconBtn} onClick={() => setCollapsed({})} title="Развернуть все">
                        <MdUnfoldMore />
                    </button>
                    <button
                        className={css.iconBtn}
                        onClick={() => {
                            const map: Record<number, boolean> = {}
                            cfg.sections.forEach((_, i) => (map[i] = true))
                            setCollapsed(map)
                        }}
                        title="Свернуть все"
                    >
                        <MdUnfoldLess />
                    </button>
                </div>
            </div>

            {cfg.sections.map((s, si) => {
                const isCollapsed = !!collapsed[si]
                const secDrop = dragOver && dragOver.si === si && dragOver.ii === undefined
                const isDraggingItem = dragRef.current?.kind === 'item'
                return (
                    <div
                        key={`sec_${si}`}
                        className={clsx(css.section, secDrop && css.dropSection, secDrop && isDraggingItem && css.dropTail)}
                        onDragOver={onSectionDragOver(si)}
                        onDrop={() => onSectionDrop(si)}
                    >
                        <div className={css.sectionHeader}>
                            <span
                                className={css.handle}
                                title="Перетащить секцию"
                                draggable
                                onDragStart={onSectionDragStart(si)}
                                onDragEnd={onDragEnd}
                            >
                                <MdDragIndicator />
                            </span>
                            <TextInput
                                name={`sec_title_${si}`}
                                label="Заголовок секции"
                                value={s.title}
                                onChange={v =>
                                    setConfig(
                                        produce(cfg, d => {
                                            d.sections[si].title = v
                                        }),
                                    )
                                }
                            />
                            <div className={css.sectionTools}>
                                <button
                                    className={css.iconBtn}
                                    title="Добавить элемент"
                                    onClick={e =>
                                        openAddMenu(e, (t: Item['type']) => {
                                            setAddMenu({ open: false })
                                            addItemEnd(si, t)
                                        })
                                    }
                                >
                                    <MdAdd />
                                </button>
                                <button className={css.iconBtn} title="Дублировать секцию" onClick={() => duplicateSection(si)}>
                                    <MdContentCopy />
                                </button>
                                <button
                                    className={css.iconBtn}
                                    title={isCollapsed ? 'Развернуть' : 'Свернуть'}
                                    onClick={() => setCollapsed(c => ({ ...c, [si]: !c[si] }))}
                                >
                                    {isCollapsed ? <MdUnfoldMore /> : <MdUnfoldLess />}
                                </button>
                                <button className={clsx(css.iconBtn, css.dangerBtn)} title="Удалить секцию" onClick={() => deleteSection(si)}>
                                    <MdDelete />
                                </button>
                            </div>
                        </div>

                        {!isCollapsed && (
                            <>
                                <div className={css.sectionBody}>{(s.items ?? []).map((it, ii) => renderItem(si, ii, it))}</div>
                                <div className={css.sectionFooter}>
                                    <button
                                        className={css.addBtn}
                                        onClick={e =>
                                            openAddMenu(e, t => {
                                                setAddMenu({ open: false })
                                                addItemEnd(si, t)
                                            })
                                        }
                                    >
                                        <MdAdd /> Добавить элемент
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )
            })}

            {addMenu.open && (
                <div className={clsx(css.addMenu, addMenu.dir === 'up' && css.addMenuUp)} style={{ left: addMenu.x, top: addMenu.y }}>
                    {typeList.map(t => (
                        <button
                            key={t}
                            className={css.addMenuItem}
                            onClick={() => {
                                addMenu.onPick(t)
                            }}
                        >
                            + {t}
                        </button>
                    ))}
                </div>
            )}

            <ChangesBar
                open={isDirty}
                text="Аккуратнее, вы не сохранили изменения!"
                onReset={() => setCfg(ensureStableKeys(structuredClone(baselineRef.current)))}
                onSave={async () => {
                    const clean = stripInternal(cfg)
                    const snap = JSON.stringify(clean)
                    if (snap === lastSavedSnapRef.current) return
                    if (saver) await saver(clean)
                    baselineRef.current = ensureStableKeys(structuredClone(cfg))
                    lastSavedSnapRef.current = JSON.stringify(stripInternal(baselineRef.current))
                    setSavedTick(t => t + 1)
                }}
            />

            <div className={css.footerSpace} />
        </div>
    )
}

export default ConfigurationSettingsEdit
