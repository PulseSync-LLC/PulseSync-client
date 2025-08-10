import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import clsx from 'clsx'
import { AddonConfig, Item, ButtonItem, SliderItem, ColorItem, FileItem, SelectorItem, TextItem, ButtonAction } from './types'

import ButtonInput from '../PSUI/ButtonInput'
import TextInput from '../PSUI/TextInput'
import SelectInput from '../PSUI/SelectInput'
import FileInput from '../PSUI/FileInput'

import BufferedColorInput from './BufferedColorInput'
import BufferedSliderInput from './BufferedSliderInput'

import * as css from './ConfigurationSettings.module.scss'
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

const ConfigurationSettings: React.FC<Props> = ({ configData, onChange, save, filePreviewSrc, ...rest }) => {
    const [cfg, setCfg] = useState<AddonConfig>(structuredClone(configData))

    const baselineRef = useRef<AddonConfig>(structuredClone(configData))
    const lastSavedSnapRef = useRef<string>(JSON.stringify(configData))

    const [savedTick, setSavedTick] = useState(0)
    const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

    useEffect(() => {
        const incoming = JSON.stringify(configData)
        const draftSnap = JSON.stringify(cfg)
        const isDirtyNow = draftSnap !== lastSavedSnapRef.current
        if (!isDirtyNow && incoming !== lastSavedSnapRef.current) {
            setCfg(structuredClone(configData))
            baselineRef.current = structuredClone(configData)
            lastSavedSnapRef.current = incoming
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
        onChange?.(next)
    }

    const isDirty = useMemo(() => JSON.stringify(cfg) !== lastSavedSnapRef.current, [cfg, savedTick])

    const resetAll = () => {
        setCfg(structuredClone(baselineRef.current))
    }

    const commitAll = useCallback(async () => {
        const snap = JSON.stringify(cfg)
        if (snap === lastSavedSnapRef.current) return
        if (saver) await saver(cfg)
        else onChange?.(cfg)

        baselineRef.current = structuredClone(cfg)
        lastSavedSnapRef.current = JSON.stringify(baselineRef.current)
        setSavedTick(t => t + 1)
    }, [cfg, saver, onChange])

    const updateItem = (si: number, ii: number, patch: Partial<Item>) =>
        setConfig(
            produce(cfg, d => {
                Object.assign(d.sections[si].items[ii], patch)
            }),
        )

    const updateTextButton = (si: number, ii: number, bi: number, patch: Partial<ButtonAction>) =>
        setConfig(
            produce(cfg, d => {
                Object.assign((d.sections[si].items[ii] as TextItem).buttons[bi], patch)
            }),
        )

    const isDirtyUsage = (item: Item): boolean => {
        switch (item.type) {
            case 'button':
                return item.bool !== item.defaultParameter
            case 'slider':
                return item.value !== item.defaultParameter
            case 'color':
                return item.input !== item.defaultParameter
            case 'file':
                return (item.defaultParameter?.filePath ?? '') !== item.filePath
            case 'selector':
                return String(item.selected) !== String(item.defaultParameter)
            case 'text':
                return item.buttons.some(b => (b.text ?? '') !== (b.defaultParameter ?? ''))
        }
    }

    const resetUsage = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                const item = d.sections[si].items[ii] as any
                switch (item.type) {
                    case 'button':
                        item.bool = (item as ButtonItem).defaultParameter
                        break
                    case 'slider':
                        item.value = (item as SliderItem).defaultParameter
                        break
                    case 'color':
                        item.input = (item as ColorItem).defaultParameter
                        break
                    case 'file':
                        item.filePath = (item as FileItem).defaultParameter?.filePath ?? ''
                        break
                    case 'selector':
                        item.selected = (item as SelectorItem).defaultParameter
                        break
                    case 'text':
                        item.buttons = (item as TextItem).buttons.map((b: ButtonAction) => ({ ...b, text: b.defaultParameter ?? '' }))
                        break
                }
            }),
        )

    const SectionTextGroup: React.FC<{ item: TextItem; si: number; ii: number }> = ({ item, si, ii }) => (
        <div className={css.list}>
            <div className={clsx(css.title, 'small')}>{item.name}</div>
            {item.buttons.map((b, bi) => {
                const dirty = (b.text ?? '') !== (b.defaultParameter ?? '')
                return (
                    <div key={b.id}>
                        <TextInput
                            name={b.id}
                            label={b.name}
                            value={b.text}
                            onChange={(val: string) => updateTextButton(si, ii, bi, { text: val })}
                            description={item.description}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button
                                    type="button"
                                    className={css.resetLink}
                                    onClick={e => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        updateTextButton(si, ii, bi, { text: b.defaultParameter ?? '' })
                                    }}
                                >
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )

    const renderItem = (si: number, ii: number, item: Item) => {
        const key = `${si}-${ii}-${item.id}`
        const dirty = isDirtyUsage(item)

        switch (item.type) {
            case 'button': {
                const it = item as ButtonItem
                return (
                    <div key={key}>
                        <ButtonInput
                            label={it.name}
                            description={it.description}
                            defaultValue={it.bool}
                            checkType={`config-${it.id}`}
                            onChange={(val: boolean) => updateItem(si, ii, { bool: val })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            case 'color': {
                const it = item as ColorItem
                return (
                    <div key={key}>
                        <BufferedColorInput
                            label={it.name}
                            description={it.description}
                            value={it.input}
                            withAlpha
                            inputModes={['hex', 'rgb', 'hsl', 'hsb']}
                            defaultMode="hex"
                            onCommit={val => updateItem(si, ii, { input: val })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            case 'selector': {
                const it = item as SelectorItem
                const opts = Object.entries(it.options).map(([k, o]) => ({ value: k, label: o.name }))
                const toNumber = typeof it.defaultParameter === 'number'
                return (
                    <div key={key}>
                        <SelectInput
                            label={it.name}
                            description={it.description}
                            value={String(it.selected)}
                            options={opts}
                            onChange={val => updateItem(si, ii, { selected: toNumber ? Number(val) : (String(val) as any) })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            case 'slider': {
                const it = item as SliderItem
                return (
                    <div key={key}>
                        <BufferedSliderInput
                            label={it.name}
                            description={it.description}
                            min={it.min}
                            max={it.max}
                            step={it.step}
                            value={it.value}
                            onCommit={val =>
                                setConfig(
                                    produce(cfg, d => {
                                        ;(d.sections[si].items[ii] as SliderItem).value = val
                                    }),
                                )
                            }
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            case 'file': {
                const it = item as FileItem
                const current = it.filePath ?? ''
                return (
                    <div key={key}>
                        <FileInput
                            label={it.name}
                            description={it.description}
                            value={current}
                            onChange={p => updateItem(si, ii, { filePath: p })}
                            previewSrc={filePreviewSrc}
                            placeholder="Выберите файл"
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ Сбросить
                                </button>
                            </div>
                        )}
                    </div>
                )
            }

            case 'text': {
                const it = item as TextItem
                return <SectionTextGroup key={key} item={it} si={si} ii={ii} />
            }

            default: {
                const u = item as Item
                return (
                    <div key={key} className={css.placeholder}>
                        <div className={css.phTitle}>{u.name}</div>
                        <div className={css.phHint}>Компонент в переработке (тип: {(u as any).type}). Скоро будет доступен.</div>
                    </div>
                )
            }
        }
    }

    return (
        <div className={css.root}>
            {cfg.sections.map((s, si) => {
                const isCollapsed = !!collapsed[si]
                return (
                    <div key={si} className={css.section}>
                        <button
                            type="button"
                            className={clsx(css.sectionHeader, isCollapsed && css.collapsed)}
                            onClick={() => setCollapsed(c => ({ ...c, [si]: !c[si] }))}
                        >
                            <span className={css.badge}>{si + 1}</span>
                            <span className={css.sectionTitle}>{s.title}</span>
                            <span className={css.chev} aria-hidden />
                        </button>

                        {!isCollapsed && (
                            <div className={css.list}>
                                {s.items.map((it, ii) => (
                                    <div key={it.id}>{renderItem(si, ii, it)}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )
            })}

            <ChangesBar open={isDirty} text="Аккуратнее, вы не сохранили изменения!" onReset={resetAll} onSave={commitAll} />
        </div>
    )
}

export default ConfigurationSettings
