import React, { useRef } from 'react'
import clsx from 'clsx'
import { AddonConfig } from '@features/configurationSettings/types'

import { MdAdd, MdUnfoldMore, MdUnfoldLess } from 'react-icons/md'
import * as css from '@features/configurationSettings/ConfigurationSettingsEdit.module.scss'
import ChangesBar from '@shared/ui/PSUI/ChangesBar'
import { useTranslation } from 'react-i18next'
import { typeList, useConfigurationEditor } from '@features/configurationSettings/model/useConfigurationEditor'
import ConfigurationSection from '@features/configurationSettings/ui/ConfigurationSection'

type Props = {
    configData: AddonConfig
    onChange?: (next: AddonConfig) => void
    save?: (next: AddonConfig) => Promise<void> | void
    filePreviewSrc?: (p: string) => string
} & Record<string, any>

const ConfigurationSettingsEdit: React.FC<Props> = ({ configData, onChange, save, filePreviewSrc, ...rest }) => {
    const { t } = useTranslation()
    const rootRef = useRef<HTMLDivElement | null>(null)
    const {
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
        setCollapsed,
        setConfig,
        updateItem,
        updateTextButton,
    } = useConfigurationEditor({
        addMenuClassName: css.addMenu,
        configData,
        onChange,
        save,
        configApiSave: rest?.configApi?.save,
        t,
    })

    return (
        <div ref={rootRef} className={css.root}>
            <div className={css.topBar}>
                <button className={css.addBtn} onClick={() => addSection()}>
                    <MdAdd /> {t('configEditor.addSection')}
                </button>
                <div className={css.rightBtns}>
                    <button className={css.iconBtn} onClick={() => setCollapsed({})} title={t('configEditor.expandAll')}>
                        <MdUnfoldMore />
                    </button>
                    <button
                        className={css.iconBtn}
                        onClick={() => {
                            const map: Record<number, boolean> = {}
                            cfg.sections.forEach((_, i) => (map[i] = true))
                            setCollapsed(map)
                        }}
                        title={t('configEditor.collapseAll')}
                    >
                        <MdUnfoldLess />
                    </button>
                </div>
            </div>

            {cfg.sections.map((section, si) => (
                <ConfigurationSection
                    key={`sec_${si}`}
                    addItemAt={addItemAt}
                    addItemEnd={addItemEnd}
                    addSelectorOption={addSelectorOption}
                    addTextButton={addTextButton}
                    cfg={cfg}
                    deleteItem={deleteItem}
                    deleteSection={deleteSection}
                    dragOver={dragOver}
                    dragRef={dragRef}
                    duplicateItem={duplicateItem}
                    duplicateSection={duplicateSection}
                    filePreviewSrc={filePreviewSrc}
                    getBaselineItem={getBaselineItem}
                    isCollapsed={!!collapsed[si]}
                    isDirtyEditor={isDirtyEditor}
                    onDragEnd={onDragEnd}
                    onItemDragOver={onItemDragOver}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    onSectionDragOver={onSectionDragOver}
                    onSectionDragStart={onSectionDragStart}
                    onSectionDrop={onSectionDrop}
                    openAddMenu={openAddMenu}
                    removeSelectorOption={removeSelectorOption}
                    removeTextButton={removeTextButton}
                    resetEditor={resetEditor}
                    section={section}
                    setAddMenu={setAddMenu}
                    setCollapsed={setCollapsed}
                    setConfig={setConfig}
                    si={si}
                    t={t}
                    updateItem={updateItem}
                    updateTextButton={updateTextButton}
                />
            ))}

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

            <ChangesBar open={isDirty} text={t('changes.unsavedWarning')} onReset={resetConfig} onSave={saveConfig} />

            <div className={css.footerSpace} />
        </div>
    )
}

export default ConfigurationSettingsEdit
