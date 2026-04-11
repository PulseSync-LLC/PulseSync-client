import React from 'react'
import clsx from 'clsx'

import { Item, ButtonItem, SliderItem, ColorItem, FileItem, SelectorItem, TextItem, AddonConfig } from '@features/configurationSettings/types'
import { produce } from '@features/configurationSettings/model/useConfigurationEditor'

import ButtonInput from '@shared/ui/PSUI/ButtonInput'
import TextInput from '@shared/ui/PSUI/TextInput'
import ColorInput from '@shared/ui/PSUI/ColorInput'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import SliderInput from '@shared/ui/PSUI/SliderInput'
import FileInput from '@shared/ui/PSUI/FileInput'

import { MdAdd, MdDelete } from 'react-icons/md'
import * as css from '@features/configurationSettings/ConfigurationSettingsEdit.module.scss'

type Props = {
    cfg: AddonConfig
    filePreviewSrc?: (path: string) => string
    ii: number
    item: Item
    setConfig: (next: AddonConfig) => void
    si: number
    t: (key: string, options?: Record<string, any>) => string
    updateItem: (si: number, ii: number, patch: Partial<Item>) => void
    updateTextButton: (si: number, ii: number, bi: number, patch: Record<string, any>) => void
    removeTextButton: (si: number, ii: number, bi: number) => void
    addTextButton: (si: number, ii: number) => void
    addSelectorOption: (si: number, ii: number) => void
    removeSelectorOption: (si: number, ii: number, key: string) => void
}

export default function ConfigurationItemBody({
    addSelectorOption,
    addTextButton,
    cfg,
    filePreviewSrc,
    ii,
    item,
    removeSelectorOption,
    removeTextButton,
    setConfig,
    si,
    t,
    updateItem,
    updateTextButton,
}: Props) {
    switch (item.type) {
        case 'button': {
            const currentItem = item as ButtonItem
            return (
                <ButtonInput
                    label={`${currentItem.name} — default`}
                    defaultValue={currentItem.defaultValue}
                    checkType={`config-default-${currentItem.id}`}
                    onChange={(value: boolean) => updateItem(si, ii, { defaultValue: value })}
                />
            )
        }
        case 'color': {
            const currentItem = item as ColorItem
            return (
                <ColorInput
                    label={`${currentItem.name} — default`}
                    value={currentItem.defaultValue}
                    onChange={value => updateItem(si, ii, { defaultValue: value })}
                    withAlpha={true}
                    inputModes={['hex', 'rgb', 'hsl', 'hsb']}
                    defaultMode="hex"
                />
            )
        }
        case 'selector': {
            const currentItem = item as SelectorItem
            const options = Object.entries(currentItem.options).map(([key, option]) => ({ value: key, label: option.name }))
            const toNumber = typeof currentItem.defaultValue === 'number'

            return (
                <>
                    <SelectInput
                        label={`${currentItem.name} — default`}
                        value={String(currentItem.defaultValue)}
                        options={options}
                        onChange={value => updateItem(si, ii, { defaultValue: toNumber ? Number(value) : (String(value) as any) })}
                    />
                    <div className={css.smallTitle}>{t('configEditor.optionsTitle')}</div>
                    <div className={css.table}>
                        {Object.entries(currentItem.options).map(([key, option]) => (
                            <div key={key} className={css.tableRow}>
                                <TextInput
                                    name={`opt_key_${key}`}
                                    label="key"
                                    value={key}
                                    onChange={value =>
                                        setConfig(
                                            produce(cfg, draft => {
                                                const optionMap = (draft.sections[si].items[ii] as SelectorItem).options
                                                const currentValue = optionMap[key]
                                                delete optionMap[key]
                                                optionMap[String(value || key)] = currentValue
                                            }),
                                        )
                                    }
                                />
                                <TextInput
                                    name={`opt_name_${key}`}
                                    label="name"
                                    value={option.name}
                                    onChange={value =>
                                        setConfig(
                                            produce(cfg, draft => {
                                                ;(draft.sections[si].items[ii] as SelectorItem).options[key].name = value
                                            }),
                                        )
                                    }
                                />
                                <TextInput
                                    name={`opt_evt_${key}`}
                                    label="event"
                                    value={option.event}
                                    onChange={value =>
                                        setConfig(
                                            produce(cfg, draft => {
                                                ;(draft.sections[si].items[ii] as SelectorItem).options[key].event = value
                                            }),
                                        )
                                    }
                                />
                                <button
                                    className={css.iconBtn}
                                    title={t('configEditor.removeOption')}
                                    onClick={() => removeSelectorOption(si, ii, key)}
                                >
                                    <MdDelete size={18} />
                                </button>
                            </div>
                        ))}
                        <div className={css.rowEnd}>
                            <button className={css.addBtn} onClick={() => addSelectorOption(si, ii)}>
                                <MdAdd /> {t('configEditor.addOption')}
                            </button>
                        </div>
                    </div>
                </>
            )
        }
        case 'slider': {
            const currentItem = item as SliderItem
            const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

            return (
                <>
                    <div className={css.inlineGrid}>
                        <TextInput
                            name={`${currentItem.id}_min`}
                            label="Min"
                            value={String(currentItem.min)}
                            onChange={value => {
                                const n = Number(value) || 0
                                const max = Math.max(n, currentItem.max)
                                updateItem(si, ii, { min: n, max, defaultValue: clamp(currentItem.defaultValue, n, max) })
                            }}
                        />
                        <TextInput
                            name={`${currentItem.id}_max`}
                            label="Max"
                            value={String(currentItem.max)}
                            onChange={value => {
                                const n = Number(value) || 0
                                const min = Math.min(currentItem.min, n)
                                updateItem(si, ii, { max: n, min, defaultValue: clamp(currentItem.defaultValue, min, n) })
                            }}
                        />
                        <TextInput
                            name={`${currentItem.id}_step`}
                            label="Step"
                            value={String(currentItem.step)}
                            onChange={value => updateItem(si, ii, { step: Math.max(1, Number(value) || 1) })}
                        />
                    </div>

                    <SliderInput
                        label={`${currentItem.name} — default`}
                        min={currentItem.min}
                        max={currentItem.max}
                        step={currentItem.step}
                        value={currentItem.defaultValue}
                        onChange={value => updateItem(si, ii, { defaultValue: value })}
                    />
                </>
            )
        }
        case 'file': {
            const currentItem = item as FileItem

            return (
                <FileInput
                    label={`${currentItem.name} — default`}
                    value={currentItem.defaultValue}
                    onChange={path => updateItem(si, ii, { defaultValue: path })}
                    previewSrc={filePreviewSrc}
                    placeholder={t('configEditor.pathPlaceholder')}
                />
            )
        }
        case 'text': {
            const currentItem = item as TextItem
            return (
                <TextInput
                    name={`${currentItem.id}_default`}
                    label="Default"
                    value={currentItem.defaultValue}
                    onChange={value => updateItem(si, ii, { defaultValue: value })}
                />
            )
        }
        default:
            return (
                <div className={css.placeholder}>
                    <div className={css.phTitle}>{t('configEditor.placeholderTitle')}</div>
                    <div className={css.phHint}>{t('configEditor.placeholderHint')}</div>
                </div>
            )
    }
}
