import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import clsx from 'clsx'
import {
    AddonConfig,
    Item,
    ButtonItem,
    SliderItem,
    ColorItem,
    FileItem,
    SelectorItem,
    TextItem,
    normalizeAddonConfig,
} from '@features/configurationSettings/types'

import ButtonInput from '@shared/ui/PSUI/ButtonInput'
import TextInput from '@shared/ui/PSUI/TextInput'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import FileInput from '@shared/ui/PSUI/FileInput'

import BufferedColorInput from '@features/configurationSettings/BufferedColorInput'
import BufferedSliderInput from '@features/configurationSettings/BufferedSliderInput'

import * as css from '@features/configurationSettings/ConfigurationSettings.module.scss'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import { useTranslation } from 'react-i18next'

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

const Collapse: React.FC<{ open: boolean; id?: string; duration?: number; children: React.ReactNode }> = ({ open, id, duration = 220, children }) => {
    const ref = useRef<HTMLDivElement>(null)
    const animRef = useRef<Animation | null>(null)
    const firstPaint = useRef(true)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        if (!open) el.setAttribute('inert', '')
        else el.removeAttribute('inert')
    }, [open])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return

        if (firstPaint.current) {
            firstPaint.current = false
            if (open) {
                el.style.height = 'auto'
                el.style.opacity = '1'
            } else {
                el.style.height = '0px'
                el.style.opacity = '0'
            }
            return
        }

        const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

        animRef.current?.cancel()

        const canAnimate = typeof el.animate === 'function' && !prefersReduced

        if (open) {
            el.style.height = 'auto'
            const target = el.scrollHeight
            el.style.height = '0px'
            el.style.opacity = '0'
            void el.getBoundingClientRect()

            if (!canAnimate) {
                el.style.height = 'auto'
                el.style.opacity = '1'
                return
            }

            animRef.current = el.animate(
                [
                    { height: '0px', opacity: 0 },
                    { height: `${target}px`, opacity: 1 },
                ],
                { duration, easing: 'cubic-bezier(.2,.9,.2,1)' },
            )
            animRef.current.onfinish = () => {
                el.style.height = 'auto'
                el.style.opacity = '1'
                animRef.current = null
            }
        } else {
            const from = el.offsetHeight
            if (!canAnimate) {
                el.style.height = '0px'
                el.style.opacity = '0'
                return
            }

            animRef.current = el.animate(
                [
                    { height: `${from}px`, opacity: 1 },
                    { height: '0px', opacity: 0 },
                ],
                { duration, easing: 'cubic-bezier(.2,.9,.2,1)' },
            )
            animRef.current.onfinish = () => {
                el.style.height = '0px'
                el.style.opacity = '0'
                animRef.current = null
            }
        }
    }, [open, duration])

    return (
        <div id={id} ref={ref} className={css.collapse} data-state={open ? 'open' : 'closed'} aria-hidden={!open}>
            {children}
        </div>
    )
}

const ConfigurationSettings: React.FC<Props> = ({ configData, onChange, save, filePreviewSrc, ...rest }) => {
    const { t } = useTranslation()
    const normalizedInitialConfig = normalizeAddonConfig(structuredClone(configData))
    const [cfg, setCfg] = useState<AddonConfig>(normalizedInitialConfig)

    const rootRef = useRef<HTMLDivElement>(null)
    const baselineRef = useRef<AddonConfig>(normalizedInitialConfig)
    const lastSavedSnapRef = useRef<string>(JSON.stringify(normalizedInitialConfig))

    const [savedTick, setSavedTick] = useState(0)
    const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

    const lastFocusedRef = useRef<HTMLElement | null>(null)
    useEffect(() => {
        const root = rootRef.current
        if (!root) return
        const onFocusIn = (e: FocusEvent) => {
            if (root.contains(e.target as Node)) lastFocusedRef.current = e.target as HTMLElement
        }
        root.addEventListener('focusin', onFocusIn)
        return () => root.removeEventListener('focusin', onFocusIn)
    }, [])
    useLayoutEffect(() => {
        if (lastFocusedRef.current && document.activeElement !== lastFocusedRef.current) {
            lastFocusedRef.current.focus?.()
        }
    })

    useEffect(() => {
        const normalizedConfig = normalizeAddonConfig(structuredClone(configData))
        const incoming = JSON.stringify(normalizedConfig)
        const draftSnap = JSON.stringify(cfg)
        const isDirtyNow = draftSnap !== lastSavedSnapRef.current
        if (!isDirtyNow && incoming !== lastSavedSnapRef.current) {
            setCfg(normalizedConfig)
            baselineRef.current = normalizedConfig
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

    const isDirtyUsage = (item: Item): boolean => {
        switch (item.type) {
            case 'button':
                return item.value !== item.defaultValue
            case 'slider':
                return item.value !== item.defaultValue
            case 'color':
                return item.value !== item.defaultValue
            case 'file':
                return item.value !== item.defaultValue
            case 'selector':
                return String(item.value) !== String(item.defaultValue)
            case 'text':
                return item.value !== item.defaultValue
        }
    }

    const resetUsage = (si: number, ii: number) =>
        setConfig(
            produce(cfg, d => {
                const item = d.sections[si].items[ii] as any
                switch (item.type) {
                    case 'button':
                        item.value = (item as ButtonItem).defaultValue
                        break
                    case 'slider':
                        item.value = (item as SliderItem).defaultValue
                        break
                    case 'color':
                        item.value = (item as ColorItem).defaultValue
                        break
                    case 'file':
                        item.value = (item as FileItem).defaultValue
                        break
                    case 'selector':
                        item.value = (item as SelectorItem).defaultValue
                        break
                    case 'text':
                        item.value = (item as TextItem).defaultValue
                        break
                }
            }),
        )

    const renderItem = (si: number, ii: number, item: Item) => {
        const dirty = isDirtyUsage(item)

        switch (item.type) {
            case 'button': {
                const it = item as ButtonItem
                return (
                    <>
                        <ButtonInput
                            label={it.name}
                            description={it.description}
                            defaultValue={it.value}
                            checkType={`config-${it.id}`}
                            onChange={(val: boolean) => updateItem(si, ii, { value: val })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            case 'color': {
                const it = item as ColorItem
                return (
                    <>
                        <BufferedColorInput
                            label={it.name}
                            description={it.description}
                            value={it.value}
                            withAlpha
                            inputModes={['hex', 'rgb', 'hsl', 'hsb']}
                            defaultMode="hex"
                            onCommit={val => updateItem(si, ii, { value: val })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            case 'selector': {
                const it = item as SelectorItem
                const opts = Object.entries(it.options).map(([k, o]) => ({ value: k, label: o.name }))
                const toNumber = typeof it.defaultValue === 'number'
                return (
                    <>
                        <SelectInput
                            label={it.name}
                            description={it.description}
                            value={String(it.value)}
                            options={opts}
                            onChange={val => updateItem(si, ii, { value: toNumber ? Number(val) : (String(val) as any) })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            case 'slider': {
                const it = item as SliderItem
                return (
                    <>
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
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            case 'file': {
                const it = item as FileItem
                const current = it.value ?? ''
                return (
                    <>
                        <FileInput
                            label={it.name}
                            description={it.description}
                            value={current}
                            onChange={p => updateItem(si, ii, { value: p })}
                            previewSrc={filePreviewSrc}
                            placeholder={t('common.selectFile')}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            case 'text': {
                const it = item as TextItem
                return (
                    <>
                        <TextInput
                            name={it.id}
                            label={it.name}
                            description={it.description}
                            value={it.value}
                            onChange={(val: string) => updateItem(si, ii, { value: val })}
                        />
                        {dirty && (
                            <div className={css.resetRow}>
                                <button type="button" className={css.resetLink} onClick={() => resetUsage(si, ii)}>
                                    ↺ {t('common.reset')}
                                </button>
                            </div>
                        )}
                    </>
                )
            }

            default: {
                const u = item as Item
                return (
                    <div className={css.placeholder}>
                        <div className={css.phTitle}>{u.name}</div>
                        <div className={css.phHint}>{t('configEditor.placeholderWithType', { type: (u as any).type })}</div>
                    </div>
                )
            }
        }
    }

    return (
        <div ref={rootRef} className={css.root}>
            {(cfg.sections ?? []).map((s, si) => {
                const isCollapsed = !!collapsed[si]
                return (
                    <div key={s.title ?? si} className={css.section}>
                        <button
                            type="button"
                            className={clsx(css.sectionHeader, isCollapsed && css.collapsed)}
                            onClick={() => setCollapsed(c => ({ ...c, [si]: !c[si] }))}
                            aria-expanded={!isCollapsed}
                            aria-controls={`section-panel-${si}`}
                        >
                            <span className={css.badge}>{si + 1}</span>
                            <span className={css.sectionTitle}>{s.title}</span>
                            <span className={css.chev} aria-hidden />
                        </button>

                        <Collapse open={!isCollapsed} id={`section-panel-${si}`}>
                            <div className={css.list}>
                                {(s.items ?? []).map((it, ii) => (
                                    <div key={it.id}>{renderItem(si, ii, it)}</div>
                                ))}
                            </div>
                        </Collapse>
                    </div>
                )
            })}

            <ChangesBar open={isDirty} text={t('changes.unsavedWarning')} onReset={resetAll} onSave={commitAll} />
        </div>
    )
}

export default ConfigurationSettings
