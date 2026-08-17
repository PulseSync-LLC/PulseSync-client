import React, { useCallback, useContext, useEffect, useState } from 'react'
import { IoCheckmarkSharp, IoCloseSharp } from 'react-icons/io5'
import {
    MdChevronRight,
    MdCode,
    MdExtension,
    MdInfoOutline,
    MdInsights,
    MdLink,
    MdScience,
    MdSettings,
    MdSystemUpdateAlt,
    MdWidgets,
} from 'react-icons/md'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { isDev } from '@common/appConfig'
import userContext from '@entities/user/model/context'
import DeveloperToolsPanel, { type DeveloperToolsSection } from '@features/developerTools/DeveloperToolsPanel'
import ExperimentOverridesPanel from '@features/developerTools/ExperimentOverridesPanel'
import { useSettingsActions } from '@features/settings/model/useSettingsActions'
import { desktopApi } from '@shared/desktop/desktopApi'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'
import * as styles from '@widgets/modalContainer/modals/SettingsModal.module.scss'

type DeveloperSetting = 'devSocket' | 'showDevFrame'
type GeneralSettingsSection = 'general' | 'integrations' | 'updates' | 'system'
type SettingsSection = GeneralSettingsSection | 'developer' | 'experiments' | DeveloperToolsSection

interface SettingsCheckboxProps {
    checked: boolean
    disabled?: boolean
    label: string
    onChange: (checked: boolean) => void
}

interface SettingsModalProps {
    onNavigate: (path: string) => void
}

interface SettingsRowProps {
    children: React.ReactNode
    description?: string
    title: string
}

const SettingsCheckbox: React.FC<SettingsCheckboxProps> = ({ checked, disabled, label, onChange }) => (
    <button
        type="button"
        className={`${styles.settingsCheckbox} ${checked ? styles.settingsCheckboxChecked : ''}`}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
    >
        {checked && <IoCheckmarkSharp size={15} aria-hidden="true" />}
    </button>
)

const SettingsRow: React.FC<SettingsRowProps> = ({ children, description, title }) => (
    <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
            <div className={styles.settingTitle}>{title}</div>
            {description && <div className={styles.settingDescription}>{description}</div>}
        </div>
        {children}
    </div>
)

const SettingsModal: React.FC<SettingsModalProps> = ({ onNavigate }) => {
    const { t } = useTranslation()
    const { app, setApp, user, isAutonomousMode } = useContext(userContext)
    const { Modals, isModalOpen, closeModal } = useModalContext()
    const [isLocalDev, setIsLocalDev] = useState(false)
    const [activeSection, setActiveSection] = useState<SettingsSection>('general')

    const isOpen = isModalOpen(Modals.SETTINGS)
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

    useEffect(() => {
        if (!hasDeveloperSection && !['general', 'integrations', 'updates', 'system'].includes(activeSection)) {
            setActiveSection('general')
        } else if (activeSection === 'experiments' && !canOverrideExperiments) {
            setActiveSection(hasDeveloperSection ? 'developer' : 'general')
        }
    }, [activeSection, canOverrideExperiments, hasDeveloperSection])

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

    const sidebarItem = (section: SettingsSection, icon: React.ReactNode, label: string) => (
        <button
            type="button"
            className={`${styles.sidebarItem} ${activeSection === section ? styles.sidebarItemActive : ''}`}
            onClick={() => setActiveSection(section)}
        >
            {icon}
            <span>{label}</span>
        </button>
    )

    const actionButton = (label: string, onClick: () => void, disabled = false) => (
        <button type="button" className={styles.actionButton} onClick={onClick} disabled={disabled}>
            <span>{label}</span>
            <MdChevronRight size={20} aria-hidden="true" />
        </button>
    )

    const toggleRow = (title: string, checked: boolean, type: string) => (
        <SettingsRow title={title}>
            <SettingsCheckbox checked={checked} label={title} onChange={value => actions.toggleSetting(type, value)} />
        </SettingsRow>
    )

    const renderGeneral = () => (
        <>
            <div className={styles.contentHeader}>
                <h2 className={styles.contentTitle}>{t('settingsModal.sections.general')}</h2>
            </div>
            <section className={styles.settingsGroup}>
                <div className={styles.groupTitle}>{t('contextMenu.appSettings.title')}</div>
                {toggleRow(t('contextMenu.appSettings.autoStartApp'), app.settings.autoStartApp, 'autoStart')}
                {toggleRow(t('contextMenu.appSettings.hardwareAcceleration'), app.settings.hardwareAcceleration, 'hardwareAcceleration')}
                {toggleRow(t('contextMenu.appSettings.autoUpdateStoreAddons'), app.settings.autoUpdateStoreAddons, 'autoUpdateStoreAddons')}
                {toggleRow(t('contextMenu.appSettings.deletePextAfterImport'), app.settings.deletePextAfterImport, 'deletePextAfterImport')}
                {app.info.devmark && (
                    <SettingsRow title={t('contextMenu.misc.showDevFrame')} description={t('settingsModal.developer.showDevFrameDescription')}>
                        <SettingsCheckbox
                            checked={app.settings.showDevFrame}
                            label={t('contextMenu.misc.showDevFrame')}
                            onChange={checked => updateDeveloperSetting('showDevFrame', checked)}
                        />
                    </SettingsRow>
                )}
            </section>
            <section className={styles.settingsGroup}>
                <div className={styles.groupTitle}>{t('contextMenu.windowSettings.title')}</div>
                {toggleRow(
                    t('contextMenu.windowSettings.saveWindowDimensions'),
                    app.settings.saveWindowDimensionsOnRestart,
                    'saveWindowDimensionsOnRestart',
                )}
                {toggleRow(
                    t('contextMenu.windowSettings.saveWindowPosition'),
                    app.settings.saveWindowPositionOnRestart,
                    'saveWindowPositionOnRestart',
                )}
            </section>
            <section className={styles.settingsGroup}>
                <div className={styles.groupTitle}>{t('contextMenu.traySettings.title')}</div>
                {toggleRow(t('contextMenu.traySettings.autoTray'), app.settings.autoStartInTray, 'autoTray')}
                {toggleRow(t('contextMenu.traySettings.hideOnClose'), app.settings.closeAppInTray, 'closeAppInTray')}
            </section>
            <section className={styles.settingsGroup}>
                <div className={styles.groupTitle}>{t('contextMenu.language.title')}</div>
                <SettingsRow title={t('contextMenu.language.russian')}>
                    <SettingsCheckbox
                        checked={app.settings.language === 'ru'}
                        label={t('contextMenu.language.russian')}
                        onChange={() => void actions.setLanguage('ru')}
                    />
                </SettingsRow>
                <SettingsRow title={t('contextMenu.language.english')}>
                    <SettingsCheckbox
                        checked={app.settings.language === 'en'}
                        label={t('contextMenu.language.english')}
                        onChange={() => void actions.setLanguage('en')}
                    />
                </SettingsRow>
            </section>
        </>
    )

    const renderIntegrations = () => (
        <>
            <div className={styles.contentHeader}>
                <h2 className={styles.contentTitle}>{t('settingsModal.sections.integrations')}</h2>
            </div>
            <section className={styles.settingsGroup}>
                <div className={styles.groupTitle}>{t('settingsModal.subscription')}</div>
                <div className={styles.actionGrid}>
                    {actions.subscriptionPageEnabled
                        ? actionButton(t('header.subscription.open'), actions.openSubscriptionPage)
                        : actionButton(t('contextMenu.boostyUrl'), actions.openBoostyUrl)}
                </div>
            </section>
            <section className={styles.settingsGroup}>
                <div className={styles.groupHeader}>
                    <div className={styles.groupTitle}>{t('contextMenu.obsWidget.title')}</div>
                    <div className={styles.groupMeta}>
                        {t(actions.widgetInstalled ? 'settingsModal.status.installed' : 'settingsModal.status.notInstalled')}
                    </div>
                </div>
                <div className={styles.actionGrid}>
                    {actionButton(
                        t('contextMenu.obsWidget.download', {
                            status: t(actions.widgetInstalled ? 'contextMenu.status.installed' : 'contextMenu.status.notInstalled'),
                        }),
                        actions.downloadObsWidget,
                        actions.widgetInstalled,
                    )}
                    {actionButton(t('contextMenu.obsWidget.openFolder'), actions.openObsWidgetDirectory, !actions.widgetInstalled)}
                    {actionButton(t('contextMenu.obsWidget.copyPath'), () => void actions.copyWidgetPath(), !actions.widgetInstalled)}
                    {actionButton(t('contextMenu.obsWidget.remove'), actions.removeObsWidget, !actions.widgetInstalled)}
                </div>
            </section>
            <section className={styles.settingsGroup}>
                <div className={styles.groupHeader}>
                    <div className={styles.groupTitle}>{t('contextMenu.mod.title')}</div>
                    <div className={styles.groupMeta}>
                        {app.mod.installed && app.mod.version
                            ? `${app.mod.name || t('contextMenu.mod.defaultName')} v${app.mod.version}`
                            : t('contextMenu.mod.notInstalled')}
                    </div>
                </div>
                <div className={styles.actionGrid}>
                    {actionButton(t('settingsModal.actions.changelog'), actions.openModChangelog, !app.mod.installed || !app.mod.version)}
                    {actionButton(t('contextMenu.mod.remove'), actions.deleteMod, !app.mod.installed || !app.mod.version)}
                    {actionButton(t('contextMenu.mod.checkUpdates'), actions.checkModUpdates, !app.mod.installed || !app.mod.version)}
                    {actionButton(t('contextMenu.mod.clearCache'), actions.clearModCache)}
                    {actions.isLinux && actionButton(t('contextMenu.mod.resetAsarPath'), actions.resetAsarPath, !actions.canResetAsarPath)}
                </div>
                {toggleRow(t('contextMenu.mod.showChangelog'), app.settings.showModModalAfterInstall, 'showModModalAfterInstall')}
            </section>
        </>
    )

    const renderUpdates = () => {
        const backendSelected = !actions.isAutonomousMode && actions.updateSource === 'backend'
        const githubSelected = actions.isAutonomousMode || actions.updateSource === 'github'

        return (
            <>
                <div className={styles.contentHeader}>
                    <h2 className={styles.contentTitle}>{t('contextMenu.updates.title')}</h2>
                </div>
                <section className={styles.settingsGroup}>
                    <div className={styles.groupTitle}>{t('settingsModal.updateSource')}</div>
                    <SettingsRow title={t('contextMenu.updates.sourceBackend')}>
                        <SettingsCheckbox
                            checked={backendSelected}
                            disabled={actions.isAutonomousMode || actions.updateSourceSwitchBlocked}
                            label={t('contextMenu.updates.sourceBackend')}
                            onChange={() => void actions.setReleaseSource('backend')}
                        />
                    </SettingsRow>
                    <SettingsRow title={t('contextMenu.updates.sourceGithub')}>
                        <SettingsCheckbox
                            checked={githubSelected}
                            disabled={actions.isAutonomousMode || actions.updateSourceSwitchBlocked}
                            label={t('contextMenu.updates.sourceGithub')}
                            onChange={() => void actions.setReleaseSource('github')}
                        />
                    </SettingsRow>
                </section>
                <section className={styles.settingsGroup}>
                    <div className={styles.groupTitle}>{t('settingsModal.actions.title')}</div>
                    <div className={styles.actionGrid}>
                        {actionButton(t('contextMenu.updates.channel'), actions.openUpdateChannelModal, actions.updateSourceSwitchBlocked)}
                        {actionButton(t('contextMenu.updates.checkAppUpdates'), actions.checkAppUpdates)}
                        {actionButton(t('contextMenu.updates.checkModUpdates'), actions.checkModUpdates)}
                    </div>
                </section>
            </>
        )
    }

    const renderSystem = () => (
        <>
            <div className={styles.contentHeader}>
                <h2 className={styles.contentTitle}>{t('contextMenu.misc.title')}</h2>
            </div>
            <section className={styles.settingsGroup}>
                <div className={styles.groupHeader}>
                    <div className={styles.groupTitle}>{t('settingsModal.application')}</div>
                    <div className={styles.groupMeta}>{`v${app.info.version} · #${app.info.branch}`}</div>
                </div>
                <div className={styles.actionGrid}>
                    {actionButton(t('settingsModal.actions.changelog'), actions.openAppChangelog)}
                    {actionButton(t('contextMenu.misc.collectLogs'), actions.collectLogs)}
                    {actionButton(t('contextMenu.appDirectory'), actions.openAppDirectory)}
                </div>
            </section>
        </>
    )

    const renderDeveloper = () => (
        <>
            <div className={styles.contentHeader}>
                <h2 className={styles.contentTitle}>{t('settingsModal.developer.title')}</h2>
            </div>
            {isLocalDev && (
                <section className={styles.settingsGroup}>
                    <div className={styles.groupTitle}>{t('settingsModal.developer.runtimeTitle')}</div>
                    <SettingsRow title={t('contextMenu.misc.websocketStatus')} description={t('settingsModal.developer.websocketDescription')}>
                        <SettingsCheckbox
                            checked={app.settings.devSocket}
                            label={t('contextMenu.misc.websocketStatus')}
                            onChange={checked => updateDeveloperSetting('devSocket', checked)}
                        />
                    </SettingsRow>
                </section>
            )}
        </>
    )

    const renderContent = () => {
        if (activeSection === 'general') return renderGeneral()
        if (activeSection === 'integrations') return renderIntegrations()
        if (activeSection === 'updates') return renderUpdates()
        if (activeSection === 'system') return renderSystem()
        if (activeSection === 'developer') return renderDeveloper()

        if (activeSection === 'experiments') {
            return <ExperimentOverridesPanel />
        }

        return <DeveloperToolsPanel section={activeSection} onNavigate={handleNavigate} />
    }

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
                    <div className={styles.sidebarTitle}>{t('settingsModal.category')}</div>
                    {sidebarItem('general', <MdSettings size={18} />, t('settingsModal.sections.general'))}
                    {sidebarItem('integrations', <MdExtension size={18} />, t('settingsModal.sections.integrations'))}
                    {sidebarItem('updates', <MdSystemUpdateAlt size={18} />, t('contextMenu.updates.title'))}
                    {sidebarItem('system', <MdInfoOutline size={18} />, t('contextMenu.misc.title'))}

                    {hasDeveloperSection && (
                        <>
                            <div className={`${styles.sidebarTitle} ${styles.sidebarTitleSpaced}`}>{t('settingsModal.developer.category')}</div>
                            {sidebarItem('developer', <MdCode size={18} />, t('settingsModal.developer.settingsTab'))}
                            {canOverrideExperiments && sidebarItem('experiments', <MdScience size={18} />, t('header.devOverrides.title'))}
                            {sidebarItem('metrics', <MdInsights size={18} />, t('dev.sections.metrics'))}
                            {sidebarItem('components', <MdWidgets size={18} />, t('settingsModal.developer.componentsTitle'))}
                            {sidebarItem('navigation', <MdLink size={18} />, t('dev.sections.navigation'))}
                        </>
                    )}
                </aside>
                <main className={styles.content}>{renderContent()}</main>
            </div>
        </CustomModalPS>
    )
}

export default SettingsModal
