import React from 'react'
import clsx from 'clsx'

import { Item } from '@features/configurationSettings/types'
import ConfigurationItemBody from '@features/configurationSettings/ui/ConfigurationItemBody'
import { AddonConfig } from '@features/configurationSettings/types'
import TextInput from '@shared/ui/PSUI/TextInput'
import { MdDragIndicator, MdContentCopy, MdDelete, MdAddCircleOutline, MdRestartAlt } from 'react-icons/md'
import * as css from '@features/configurationSettings/ConfigurationSettingsEdit.module.scss'

type Props = {
    addItemAt: (si: number, index: number, type: Item['type']) => void
    addSelectorOption: (si: number, ii: number) => void
    addTextButton: (si: number, ii: number) => void
    cfg: AddonConfig
    deleteItem: (si: number, ii: number) => void
    dirty: boolean
    dropAfter: boolean | null
    dropBefore: boolean | null
    duplicateItem: (si: number, ii: number) => void
    filePreviewSrc?: (path: string) => string
    item: Item
    onDragEnd: () => void
    onItemDragOver: (si: number, ii: number) => (e: React.DragEvent) => void
    onItemDragStart: (si: number, ii: number) => (e: React.DragEvent) => void
    onItemDrop: (si: number, ii: number) => (e: React.DragEvent) => void
    openAddMenu: (event: React.MouseEvent, onPick: (t: Item['type']) => void) => void
    removeSelectorOption: (si: number, ii: number, key: string) => void
    removeTextButton: (si: number, ii: number, bi: number) => void
    resetEditor: (si: number, ii: number) => void
    setAddMenu: React.Dispatch<React.SetStateAction<any>>
    setConfig: (next: AddonConfig) => void
    si: number
    ii: number
    t: (key: string, options?: Record<string, any>) => string
    updateItem: (si: number, ii: number, patch: Partial<Item>) => void
    updateTextButton: (si: number, ii: number, bi: number, patch: Record<string, any>) => void
}

export default function ConfigurationItemCard({
    addItemAt,
    addSelectorOption,
    addTextButton,
    cfg,
    deleteItem,
    dirty,
    dropAfter,
    dropBefore,
    duplicateItem,
    filePreviewSrc,
    item,
    onDragEnd,
    onItemDragOver,
    onItemDragStart,
    onItemDrop,
    openAddMenu,
    removeSelectorOption,
    removeTextButton,
    resetEditor,
    setAddMenu,
    setConfig,
    si,
    ii,
    t,
    updateItem,
    updateTextButton,
}: Props) {
    return (
        <div
            key={(item as any).__k}
            className={clsx(css.item, dropBefore && css.dropBefore, dropAfter && css.dropAfter)}
            onDragOver={onItemDragOver(si, ii)}
            onDrop={onItemDrop(si, ii)}
        >
            <div className={css.itemHeader}>
                <span className={css.handle} title={t('configEditor.drag')} draggable onDragStart={onItemDragStart(si, ii)} onDragEnd={onDragEnd}>
                    <MdDragIndicator />
                </span>

                <div className={css.metaGrid}>
                    <TextInput
                        name={`item_name_${item.id}`}
                        label={t('configEditor.labels.name')}
                        value={item.name}
                        onChange={value => updateItem(si, ii, { name: value } as Partial<Item>)}
                    />
                    <TextInput
                        name={`item_id_${item.id}`}
                        label="ID"
                        value={item.id}
                        onChange={value => updateItem(si, ii, { id: value } as Partial<Item>)}
                    />
                </div>

                <div className={css.tools}>
                    <button
                        className={css.iconBtn}
                        title={t('configEditor.addItemAfter')}
                        onClick={event =>
                            openAddMenu(event, (type: Item['type']) => {
                                setAddMenu({ open: false })
                                addItemAt(si, ii + 1, type)
                            })
                        }
                    >
                        <MdAddCircleOutline size={18} />
                    </button>

                    <button className={css.iconBtn} title={t('configEditor.duplicate')} onClick={() => duplicateItem(si, ii)}>
                        <MdContentCopy size={18} />
                    </button>
                    {dirty && (
                        <button
                            className={clsx(css.iconBtn, css.warnBtn)}
                            title={t('configEditor.resetToDefault')}
                            onClick={() => resetEditor(si, ii)}
                        >
                            <MdRestartAlt size={18} />
                        </button>
                    )}
                    <button className={clsx(css.iconBtn, css.dangerBtn)} title={t('common.delete')} onClick={() => deleteItem(si, ii)}>
                        <MdDelete size={18} />
                    </button>
                </div>
            </div>

            <TextInput
                name={`item_desc_${item.id}`}
                label={t('configEditor.labels.description')}
                value={item.description ?? ''}
                onChange={value => updateItem(si, ii, { description: value } as Partial<Item>)}
            />

            <div className={css.body}>
                <ConfigurationItemBody
                    addSelectorOption={addSelectorOption}
                    addTextButton={addTextButton}
                    cfg={cfg}
                    filePreviewSrc={filePreviewSrc}
                    ii={ii}
                    item={item}
                    removeSelectorOption={removeSelectorOption}
                    removeTextButton={removeTextButton}
                    setConfig={setConfig}
                    si={si}
                    t={t}
                    updateItem={updateItem}
                    updateTextButton={updateTextButton}
                />
            </div>
        </div>
    )
}
