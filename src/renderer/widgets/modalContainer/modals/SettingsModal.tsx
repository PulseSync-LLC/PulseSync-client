import React, { lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react'
import { IoCheckmarkSharp, IoCloseSharp } from 'react-icons/io5'
import { MdCode, MdInsights, MdLink, MdWidgets } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import userContext from '@entities/user/model/context'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import Loader from '@shared/ui/PSUI/Loader'
import toast from '@shared/ui/toast'
import { desktopApi } from '@shared/desktop/desktopApi'
import type { DeveloperToolsSection } from '@features/developerTools/DeveloperToolsPanel'
import * as styles from '@widgets/modalContainer/modals/SettingsModal.module.scss'

const DeveloperToolsPanel = lazy(() => import('@features/developerTools/DeveloperToolsPanel'))

type DeveloperSetting = 'devSocket' | 'showDevFrame'
type SettingsSection = 'developer' | DeveloperToolsSection

interface SettingsCheckboxProps {
    checked: boolean
    label: string
    onChange: (checked: boolean) => void
}

interface SettingsModalProps {
    onNavigate: (path: string) => void
}

const SettingsCheckbox: React.FC<SettingsCheckboxProps> = ({ checked, label, onChange }) => (
    <button
        type="button"
        className={`${styles.settingsCheckbox} ${checked ? styles.settingsCheckboxChecked : ''}`}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
    >
        {checked && <IoCheckmarkSharp size={15} aria-hidden="true" />}
    </button>
)

const SettingsModal: React.FC<SettingsModalProps> = ({ onNavigate }) => {
    const { t } = useTranslation()
    const { app, setApp, user } = useContext(userContext)
    const { Modals, isModalOpen, closeModal } = useModalContext()
    const [isLocalDev, setIsLocalDev] = useState(false)
    const [activeSection, setActiveSection] = useState<SettingsSection>('developer')

    const isOpen = isModalOpen(Modals.SETTINGS)
    const hasDeveloperSection = app.info.devmark || user?.perms === 'developer'

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
        closeModal(Modals.SETTINGS)
    }, [Modals.SETTINGS, closeModal])

    const handleNavigate = useCallback(
        (path: string) => {
            handleClose()
            onNavigate(path)
        },
        [handleClose, onNavigate],
    )

    const updateSetting = useCallback(
        (setting: DeveloperSetting, value: boolean) => {
            void desktopApi.settings.updatePreferences({ [setting]: value })
            setApp(previous => ({
                ...previous,
                settings: {
                    ...previous.settings,
                    [setting]: value,
                },
            }))
            const settingLabel = setting === 'showDevFrame' ? t('contextMenu.misc.showDevFrame') : t('contextMenu.misc.websocketStatus')
            toast.custom('success', t('common.doneTitle'), `${settingLabel}: ${t(value ? 'common.enabled' : 'common.disabled')}`)
        },
        [setApp, t],
    )

    return (
        <CustomModalPS
            className={styles.modal}
            title={
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>{t('settingsModal.title')}</div>
                    <button type="button" className={styles.closeButton} onClick={handleClose} aria-label={t('common.cancel')}>
                        <IoCloseSharp size={20} />
                    </button>
                </div>
            }
            isOpen={isOpen}
            onClose={handleClose}
        >
            <div className={styles.settingsShell}>
                <aside className={styles.sidebar}>
                    {hasDeveloperSection && (
                        <>
                            <div className={styles.sidebarTitle}>{t('settingsModal.developer.category')}</div>
                            <button
                                type="button"
                                className={`${styles.sidebarItem} ${activeSection === 'developer' ? styles.sidebarItemActive : ''}`}
                                onClick={() => setActiveSection('developer')}
                            >
                                <MdCode size={18} />
                                <span>{t('settingsModal.developer.settingsTab')}</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.sidebarItem} ${activeSection === 'metrics' ? styles.sidebarItemActive : ''}`}
                                onClick={() => setActiveSection('metrics')}
                            >
                                <MdInsights size={18} />
                                <span>{t('dev.sections.metrics')}</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.sidebarItem} ${activeSection === 'components' ? styles.sidebarItemActive : ''}`}
                                onClick={() => setActiveSection('components')}
                            >
                                <MdWidgets size={18} />
                                <span>{t('settingsModal.developer.componentsTitle')}</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.sidebarItem} ${activeSection === 'navigation' ? styles.sidebarItemActive : ''}`}
                                onClick={() => setActiveSection('navigation')}
                            >
                                <MdLink size={18} />
                                <span>{t('dev.sections.navigation')}</span>
                            </button>
                        </>
                    )}
                </aside>

                <main className={styles.content}>
                    {hasDeveloperSection ? (
                        activeSection === 'developer' ? (
                            <>
                                <div className={styles.contentHeader}>
                                    <h2 className={styles.contentTitle}>{t('settingsModal.developer.title')}</h2>
                                </div>

                                <section className={styles.settingsGroup}>
                                    <div className={styles.groupTitle}>{t('settingsModal.developer.interfaceTitle')}</div>
                                    <div className={styles.settingRow}>
                                        <div className={styles.settingCopy}>
                                            <div className={styles.settingTitle}>{t('contextMenu.misc.showDevFrame')}</div>
                                            <div className={styles.settingDescription}>{t('settingsModal.developer.showDevFrameDescription')}</div>
                                        </div>
                                        <SettingsCheckbox
                                            checked={app.settings.showDevFrame}
                                            label={t('contextMenu.misc.showDevFrame')}
                                            onChange={checked => updateSetting('showDevFrame', checked)}
                                        />
                                    </div>
                                </section>

                                {isLocalDev && (
                                    <section className={styles.settingsGroup}>
                                        <div className={styles.groupTitle}>{t('settingsModal.developer.runtimeTitle')}</div>
                                        <div className={styles.settingRow}>
                                            <div className={styles.settingCopy}>
                                                <div className={styles.settingTitle}>{t('contextMenu.misc.websocketStatus')}</div>
                                                <div className={styles.settingDescription}>{t('settingsModal.developer.websocketDescription')}</div>
                                            </div>
                                            <SettingsCheckbox
                                                checked={app.settings.devSocket}
                                                label={t('contextMenu.misc.websocketStatus')}
                                                onChange={checked => updateSetting('devSocket', checked)}
                                            />
                                        </div>
                                    </section>
                                )}
                            </>
                        ) : (
                            <Suspense
                                fallback={
                                    <div className={styles.toolsLoading}>
                                        <Loader variant="panel" />
                                    </div>
                                }
                            >
                                <DeveloperToolsPanel section={activeSection} onNavigate={handleNavigate} />
                            </Suspense>
                        )
                    ) : (
                        <div className={styles.emptyState}>
                            <div className={styles.emptyTitle}>{t('settingsModal.emptyTitle')}</div>
                            <div className={styles.emptyDescription}>{t('settingsModal.emptyDescription')}</div>
                        </div>
                    )}
                </main>
            </div>
        </CustomModalPS>
    )
}

export default SettingsModal
