import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdClose, MdSearch } from 'react-icons/md'

import BufferedColorInput from '@features/configurationSettings/BufferedColorInput'
import BufferedSliderInput from '@features/configurationSettings/BufferedSliderInput'
import { useCollapsedSections } from '@features/configurationSettings/model/useCollapsedSections'
import { normalizeAddonConfig } from '@features/configurationSettings/types'
import ButtonInput from '@shared/ui/PSUI/ButtonInput'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import FileInput from '@shared/ui/PSUI/FileInput'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import TextInput from '@shared/ui/PSUI/TextInput'

import * as css from '@features/configurationSettings/ConfigurationSettings.module.scss'

import type { AddonConfig, ButtonItem, ColorItem, FileItem, Item, SelectorItem, SliderItem, TextItem } from '@features/configurationSettings/types'

type Props = {
    addonId: string
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

const ConfigurationSettings: React.FC<Props> = ({ addonId, configData, onChange, save, filePreviewSrc, ...rest }) => {
    const { t } = useTranslation()
    const normalizedInitialConfig = normalizeAddonConfig(structuredClone(configData))
    const [cfg, setCfg] = useState<AddonConfig>(normalizedInitialConfig)
    const [search, setSearch] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)
    const searchTerms = search.toLocaleLowerCase().replace(/ё/g, 'е').trim().split(/\s+/).filter(Boolean)
    const matches = (sectionTitle: string, item: Item) => {
        const text = [
            sectionTitle,
            item.name,
            item.description,
            item.id,
            ...(item.type === 'selector' ? Object.values(item.options).map(option => option.name) : []),
        ]
            .join(' ')
            .toLocaleLowerCase()
            .replace(/ё/g, 'е')
        return searchTerms.every(term => text.includes(term))
    }
    const hasResults = cfg.sections.some(section => section.items.some(item => matches(section.title, item)))

    const rootRef = useRef<HTMLDivElement>(null)
    const baselineRef = useRef<AddonConfig>(normalizedInitialConfig)
    const lastSavedSnapRef = useRef<string>(JSON.stringify(normalizedInitialConfig))

    const [savedTick, setSavedTick] = useState(0)
    const [collapsed, setCollapsed] = useCollapsedSections(addonId, cfg.sections)

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
        if (lastFocusedRef.current?.offsetParent && document.activeElement !== lastFocusedRef.current) {
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
                return Object.values(item.options).some(option => 'value' in option)
                    ? !Object.is(item.value, item.defaultValue)
                    : String(item.value) !== String(item.defaultValue)
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
                            className={css.controlCard}
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
                            className={css.controlCard}
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
                            className={css.controlCard}
                            label={it.name}
                            description={it.description}
                            value={
                                Object.entries(it.options).find(([key, option]) =>
                                    Object.is(option.value ?? (toNumber ? Number(key) : key), it.value),
                                )?.[0] ?? ''
                            }
                            options={opts}
                            onChange={val => {
                                const option = it.options[String(val)]
                                if (!option) return
                                const value = option.value ?? (toNumber ? Number(val) : String(val))
                                if (typeof value === 'number' && !Number.isFinite(value)) return
                                updateItem(si, ii, { value })
                            }}
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
                            className={css.controlCard}
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
                            className={css.controlCard}
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
                            className={css.controlCard}
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
            <div className={css.searchBox}>
                <MdSearch className={css.searchIcon} size={18} aria-hidden="true" />
                <input
                    ref={searchRef}
                    type="search"
                    className={css.search}
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder={t('settingsModal.searchPlaceholder')}
                    aria-label={t('settingsModal.searchPlaceholder')}
                />
                <button
                    type="button"
                    className={css.searchClear}
                    hidden={!search}
                    aria-label={t('common.clear')}
                    onClick={() => {
                        setSearch('')
                        searchRef.current?.focus()
                    }}
                >
                    <MdClose size={16} aria-hidden="true" />
                </button>
            </div>
            {!hasResults && (
                <p className={css.searchEmpty} aria-live="polite">
                    {t('settingsModal.searchEmpty')}
                </p>
            )}
            {(cfg.sections ?? []).map((s, si) => {
                const isCollapsed = searchTerms.length === 0 && !!collapsed[si]
                const sectionMatches = s.items.some(item => matches(s.title, item))
                return (
                    <div key={s.title ?? si} className={css.section} hidden={!sectionMatches}>
                        <button
                            type="button"
                            className={clsx(css.sectionHeader, isCollapsed && css.collapsed)}
                            onClick={() => {
                                if (!searchTerms.length) setCollapsed(c => ({ ...c, [si]: !c[si] }))
                            }}
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
                                    <div key={it.id} hidden={!matches(s.title, it)}>
                                        {renderItem(si, ii, it)}
                                    </div>
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
