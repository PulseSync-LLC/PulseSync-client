import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { SearchBox } from '@pulsesync/uikit/inputs'
import { useTranslation } from 'react-i18next'
import { IoCloseSharp } from 'react-icons/io5'

import { isDev } from '@common/appConfig'
import { useModalContext } from '@app/providers/modal'
import SettingsNavigation from '@widgets/modalContainer/modals/SettingsModal/components/SettingsNavigation'
import SettingsSection from '@widgets/modalContainer/modals/SettingsModal/components/SettingsSection'
import { useSettingsSchema } from '@widgets/modalContainer/modals/SettingsModal/model/useSettingsSchema'
import { useSettingsActions } from '@features/settings/model/useSettingsActions'
import userContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'

import * as styles from '@widgets/modalContainer/modals/SettingsModal/SettingsModal.module.scss'

import type { DeveloperSetting, SettingsCategorySchema, SettingsSectionId } from '@widgets/modalContainer/modals/SettingsModal/model/types'

interface SettingsModalProps {
    onNavigate: (path: string) => void
}

const filterSettingsCategories = (categories: SettingsCategorySchema[], query: string): SettingsCategorySchema[] => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return categories

    const matches = (...values: Array<string | undefined>) => values.some(value => value?.toLocaleLowerCase().includes(normalizedQuery))

    return categories.flatMap(category => {
        const categoryMatches = matches(category.label)
        const sections = category.sections.flatMap(section => {
            const sectionMatches = categoryMatches || matches(section.label, section.title)
            if (sectionMatches) return [section]
            if (section.content.kind === 'custom') return []

            const groups = section.content.groups.flatMap(group => {
                const groupMatches = matches(group.title, group.meta)
                const items = groupMatches
                    ? group.items
                    : group.items.filter(item => matches(item.label, 'description' in item ? item.description : undefined))
                return items.length ? [{ ...group, items }] : []
            })

            return groups.length
                ? [
                      {
                          ...section,
                          content: { kind: 'groups' as const, groups },
                      },
                  ]
                : []
        })

        return sections.length ? [{ ...category, sections }] : []
    })
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onNavigate }) => {
    const { t } = useTranslation()
    const { app, setApp, user, isAutonomousMode } = useContext(userContext)
    const { Modals, isModalOpen, closeModal, getModalState, setModalState } = useModalContext()
    const [isLocalDev, setIsLocalDev] = useState(false)
    const [activeSection, setActiveSection] = useState<SettingsSectionId>('general')
    const [searchQuery, setSearchQuery] = useState('')

    const isOpen = isModalOpen(Modals.SETTINGS)
    const requestedSection = getModalState(Modals.SETTINGS).activeSection
    const hasDeveloperSection = user?.perms === 'developer' || isDev
    const canOverrideExperiments = user?.perms === 'developer' && !isAutonomousMode
    const actions = useSettingsActions(isOpen)

    useEffect(() => {
        if (!isOpen || !hasDeveloperSection) return

        let active = true
        void desktopApi.getRuntimeInfo().then(runtimeInfo => {
            if (active) setIsLocalDev(runtimeInfo.isDev)
        })

        return () => {
            active = false
        }
    }, [hasDeveloperSection, isOpen])

    const handleClose = useCallback(() => {
        setSearchQuery('')
        closeModal(Modals.SETTINGS)
    }, [Modals.SETTINGS, closeModal])

    const handleNavigate = useCallback(
        (path: string) => {
            handleClose()
            onNavigate(path)
        },
        [handleClose, onNavigate],
    )

    const updateDeveloperSetting = useCallback(
        (setting: DeveloperSetting, value: boolean) => {
            void desktopApi.settings.updatePreferences({ [setting]: value })
            setApp(previous => ({
                ...previous,
                settings: { ...previous.settings, [setting]: value },
            }))
            const settingLabel = setting === 'showDevFrame' ? t('contextMenu.misc.showDevFrame') : t('contextMenu.misc.websocketStatus')
            toast.custom('success', t('common.doneTitle'), `${settingLabel}: ${t(value ? 'common.enabled' : 'common.disabled')}`)
        },
        [setApp, t],
    )

    const categories = useSettingsSchema({
        actions,
        app,
        canOverrideExperiments,
        hasDeveloperSection,
        isLocalDev,
        onNavigate: handleNavigate,
        onUpdateDeveloperSetting: updateDeveloperSetting,
    })
    const visibleCategories = useMemo(() => filterSettingsCategories(categories, searchQuery), [categories, searchQuery])
    const sections = visibleCategories.flatMap(category => category.sections)
    const activeSectionExists = sections.some(section => section.id === activeSection)
    const fallbackSection = visibleCategories.find(category => category.id === 'developer')?.sections[0]?.id ?? sections[0]?.id ?? 'general'
    const displayedSection = sections.find(section => section.id === activeSection) ?? sections.find(section => section.id === fallbackSection)

    useEffect(() => {
        if (isOpen && requestedSection) {
            setActiveSection(requestedSection)
            setModalState(Modals.SETTINGS, { activeSection: undefined })
        }
    }, [Modals.SETTINGS, isOpen, requestedSection, setModalState])

    useEffect(() => {
        if (!activeSectionExists) {
            setActiveSection(fallbackSection)
        }
    }, [activeSectionExists, fallbackSection])

    return (
        <CustomModalPS
            className={styles.modal}
            title={
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>{t('settingsModal.title')}</div>
                    <SearchBox
                        className={styles.searchBox}
                        value={searchQuery}
                        placeholder={t('settingsModal.searchPlaceholder')}
                        aria-label={t('settingsModal.searchPlaceholder')}
                        onChange={setSearchQuery as never}
                    />
                    <button type="button" className={styles.closeButton} onClick={handleClose} aria-label={t('common.cancel')}>
                        <IoCloseSharp size={20} aria-hidden="true" />
                    </button>
                </div>
            }
            isOpen={isOpen}
            onClose={handleClose}
        >
            <div className={styles.settingsShell}>
                <SettingsNavigation activeSection={activeSection} categories={visibleCategories} onSelect={setActiveSection} />
                <main className={styles.content}>
                    {displayedSection ? (
                        <SettingsSection section={displayedSection} />
                    ) : (
                        <div className={styles.searchEmpty}>{t('settingsModal.searchEmpty')}</div>
                    )}
                </main>
            </div>
        </CustomModalPS>
    )
}

export default SettingsModal
