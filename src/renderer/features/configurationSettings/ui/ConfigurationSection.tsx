import React from 'react'
import clsx from 'clsx'

import { AddonConfig, Item } from '@features/configurationSettings/types'
import { produce } from '@features/configurationSettings/model/useConfigurationEditor'
import ConfigurationItemCard from '@features/configurationSettings/ui/ConfigurationItemCard'
import TextInput from '@shared/ui/PSUI/TextInput'
import { MdDragIndicator, MdContentCopy, MdDelete, MdAdd, MdUnfoldMore, MdUnfoldLess } from 'react-icons/md'
import * as css from '@features/configurationSettings/ConfigurationSettingsEdit.module.scss'

type Props = {
    addItemAt: (si: number, index: number, type: Item['type']) => void
    addItemEnd: (si: number, type: Item['type']) => void
    addSelectorOption: (si: number, ii: number) => void
    addTextButton: (si: number, ii: number) => void
    cfg: AddonConfig
    deleteItem: (si: number, ii: number) => void
    deleteSection: (si: number) => void
    dragOver: { si: number; ii?: number; where?: 'before' | 'after' } | null
    dragRef: React.MutableRefObject<{ kind: 'section' | 'item'; fromSi: number; fromIi?: number } | null>
    duplicateItem: (si: number, ii: number) => void
    duplicateSection: (si: number) => void
    filePreviewSrc?: (path: string) => string
    getBaselineItem: (si: number, ii: number) => Item | undefined
    isCollapsed: boolean
    isDirtyEditor: (item: Item, base?: Item) => boolean
    onDragEnd: () => void
    onItemDragOver: (si: number, ii: number) => (e: React.DragEvent) => void
    onItemDragStart: (si: number, ii: number) => (e: React.DragEvent) => void
    onItemDrop: (si: number, ii: number) => (e: React.DragEvent) => void
    onSectionDragOver: (si: number) => (e: React.DragEvent) => void
    onSectionDragStart: (si: number) => (e: React.DragEvent) => void
    onSectionDrop: (si: number) => void
    openAddMenu: (event: React.MouseEvent, onPick: (t: Item['type']) => void) => void
    removeSelectorOption: (si: number, ii: number, key: string) => void
    removeTextButton: (si: number, ii: number, bi: number) => void
    resetEditor: (si: number, ii: number) => void
    section: AddonConfig['sections'][number]
    setAddMenu: React.Dispatch<React.SetStateAction<any>>
    setCollapsed: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
    setConfig: (next: AddonConfig) => void
    si: number
    t: (key: string, options?: Record<string, any>) => string
    updateItem: (si: number, ii: number, patch: Partial<Item>) => void
    updateTextButton: (si: number, ii: number, bi: number, patch: Record<string, any>) => void
}

export default function ConfigurationSection({
    addItemAt,
    addItemEnd,
    addSelectorOption,
    addTextButton,
    cfg,
    deleteItem,
    deleteSection,
    dragOver,
    dragRef,
    duplicateItem,
    duplicateSection,
    filePreviewSrc,
    getBaselineItem,
    isCollapsed,
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
    resetEditor,
    section,
    setAddMenu,
    setCollapsed,
    setConfig,
    si,
    t,
    updateItem,
    updateTextButton,
}: Props) {
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
                    title={t('configEditor.dragSection')}
                    draggable
                    onDragStart={onSectionDragStart(si)}
                    onDragEnd={onDragEnd}
                >
                    <MdDragIndicator />
                </span>
                <TextInput
                    name={`sec_title_${si}`}
                    label={t('configEditor.labels.sectionTitle')}
                    value={section.title}
                    onChange={value =>
                        setConfig(
                            produce(cfg, draft => {
                                draft.sections[si].title = value
                            }),
                        )
                    }
                />
                <div className={css.sectionTools}>
                    <button
                        className={css.iconBtn}
                        title={t('configEditor.addItem')}
                        onClick={event =>
                            openAddMenu(event, (type: Item['type']) => {
                                setAddMenu({ open: false })
                                addItemEnd(si, type)
                            })
                        }
                    >
                        <MdAdd />
                    </button>
                    <button className={css.iconBtn} title={t('configEditor.duplicateSection')} onClick={() => duplicateSection(si)}>
                        <MdContentCopy />
                    </button>
                    <button
                        className={css.iconBtn}
                        title={isCollapsed ? t('configEditor.expand') : t('configEditor.collapse')}
                        onClick={() => setCollapsed(collapsed => ({ ...collapsed, [si]: !collapsed[si] }))}
                    >
                        {isCollapsed ? <MdUnfoldMore /> : <MdUnfoldLess />}
                    </button>
                    <button className={clsx(css.iconBtn, css.dangerBtn)} title={t('configEditor.deleteSection')} onClick={() => deleteSection(si)}>
                        <MdDelete />
                    </button>
                </div>
            </div>

            {!isCollapsed && (
                <>
                    <div className={css.sectionBody}>
                        {(section.items ?? []).map((item, ii) => {
                            const base = getBaselineItem(si, ii)
                            const dirty = isDirtyEditor(item, base)
                            const dropBefore = dragOver && dragOver.si === si && dragOver.ii === ii && dragOver.where === 'before'
                            const dropAfter = dragOver && dragOver.si === si && dragOver.ii === ii && dragOver.where === 'after'

                            return (
                                <ConfigurationItemCard
                                    key={(item as any).__k}
                                    addItemAt={addItemAt}
                                    addSelectorOption={addSelectorOption}
                                    addTextButton={addTextButton}
                                    cfg={cfg}
                                    deleteItem={deleteItem}
                                    dirty={!!(base && dirty)}
                                    dropAfter={dropAfter}
                                    dropBefore={dropBefore}
                                    duplicateItem={duplicateItem}
                                    filePreviewSrc={filePreviewSrc}
                                    item={item}
                                    onDragEnd={onDragEnd}
                                    onItemDragOver={onItemDragOver}
                                    onItemDragStart={onItemDragStart}
                                    onItemDrop={onItemDrop}
                                    openAddMenu={openAddMenu}
                                    removeSelectorOption={removeSelectorOption}
                                    removeTextButton={removeTextButton}
                                    resetEditor={resetEditor}
                                    setAddMenu={setAddMenu}
                                    setConfig={setConfig}
                                    si={si}
                                    ii={ii}
                                    t={t}
                                    updateItem={updateItem}
                                    updateTextButton={updateTextButton}
                                />
                            )
                        })}
                    </div>
                    <div className={css.sectionFooter}>
                        <button
                            className={css.addBtn}
                            onClick={event =>
                                openAddMenu(event, type => {
                                    setAddMenu({ open: false })
                                    addItemEnd(si, type)
                                })
                            }
                        >
                            <MdAdd /> {t('configEditor.addItem')}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
