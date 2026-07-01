import React from 'react'
import { MdWorkspacePremium } from 'react-icons/md'

import ArrowContext from '@shared/assets/icons/arrowContext.svg'
import * as menuStyles from '@features/context_menu/context_menu.module.scss'
import type { ModalName } from '@app/providers/modal/types'

export interface SectionItem {
    label: React.ReactNode
    onClick?: (event: any) => void
    disabled?: boolean
    isDev?: boolean
}

export interface SectionConfig {
    title?: string
    buttons?: SectionItem[]
    content?: React.ReactNode
}

type IconProps = React.SVGProps<SVGSVGElement> & {
    size?: number | string
}

function BoostyIcon({ size = 18, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" {...props}>
            <path d="M2.661 14.337 6.801 0h6.362L11.88 4.444l-.038.077-3.378 11.733h3.15c-1.321 3.289-2.35 5.867-3.086 7.733l-5.816-.063-7.442-4.228-6.02-9.155M8.554 24l7.67-11.035h-3.25l2.83-7.073c4.852.508 7.137 4.33 5.791 8.952C20.16 19.81 14.344 24 8.68 24h-.127z" />
        </svg>
    )
}

function createButtonSection(title: string, buttons: SectionItem[]): SectionConfig {
    return { title, buttons }
}

function createContentSection(content: React.ReactNode): SectionConfig {
    return { content }
}

function createToggleButton(
    title: string,
    checked: boolean,
    onToggle: () => void,
    isDev?: boolean,
    disabled = false,
    isDevRuntime = false,
): SectionItem {
    if (isDev && !isDevRuntime) {
        return null as any
    }

    return {
        label: (
            <>
                <span>{title}</span>
                <div className={menuStyles.custom_checkbox_menu}>
                    <div
                        className={checked ? `${menuStyles.custom_checkbox_menu_dot} ${menuStyles.active}` : menuStyles.custom_checkbox_menu_dot}
                    ></div>
                </div>
            </>
        ),
        onClick: disabled
            ? undefined
            : () => {
                  onToggle()
              },
        disabled,
    }
}

type UpdateSource = 'backend' | 'github'

type Params = {
    app: any
    canResetAsarPath: boolean
    checkAppUpdates: () => void
    checkModUpdates: () => void
    clearModCache: () => void
    collectLogs: () => void
    copyWidgetPath: () => void
    deleteMod: (event: any) => void
    downloadObsWidget: () => void
    isAutonomousMode: boolean
    isDevRuntime: boolean
    isLinux: boolean
    openAppDirectory: () => void
    openBoostyUrl: () => void
    openObsWidgetDirectory: () => void
    openSubscriptionPage: () => void
    subscriptionPageEnabled: boolean
    openUpdateChannelModal: () => void
    openModal: (modal: ModalName) => void
    openUpdateModal: () => void
    removeObsWidget: () => void
    resetAsarPath: () => void
    setLanguage: (language: string) => void
    setUpdateSource: (source: UpdateSource) => void
    t: (key: string, options?: any) => string
    toggleSetting: (type: string, status: boolean) => void
    updateSource: UpdateSource
    updateSourceSwitchBlocked: boolean
    widgetInstalled: boolean
    appBranch: string
    modals: {
        MOD_CHANGELOG: ModalName
    }
}

export function buildContextMenuSections({
    app,
    canResetAsarPath,
    checkAppUpdates,
    checkModUpdates,
    clearModCache,
    collectLogs,
    copyWidgetPath,
    deleteMod,
    downloadObsWidget,
    isAutonomousMode,
    isDevRuntime,
    isLinux,
    openAppDirectory,
    openBoostyUrl,
    openObsWidgetDirectory,
    openSubscriptionPage,
    subscriptionPageEnabled,
    openUpdateChannelModal,
    openModal,
    openUpdateModal,
    removeObsWidget,
    resetAsarPath,
    setLanguage,
    setUpdateSource,
    t,
    toggleSetting,
    updateSource,
    updateSourceSwitchBlocked,
    widgetInstalled,
    appBranch,
    modals,
}: Params): SectionConfig[] {
    const updateSourceButtons = isAutonomousMode
        ? [
              createToggleButton(t('contextMenu.updates.sourceBackend'), false, () => void 0, undefined, true),
              createToggleButton(t('contextMenu.updates.sourceGithub'), true, () => void 0, undefined, true),
          ]
        : [
              createToggleButton(
                  t('contextMenu.updates.sourceBackend'),
                  updateSource === 'backend',
                  () => setUpdateSource('backend'),
                  undefined,
                  updateSourceSwitchBlocked,
              ),
              createToggleButton(
                  t('contextMenu.updates.sourceGithub'),
                  updateSource === 'github',
                  () => setUpdateSource('github'),
                  undefined,
                  updateSourceSwitchBlocked,
              ),
          ]

    return [
        createContentSection(
            subscriptionPageEnabled ? (
                <button className={menuStyles.contextButton} onClick={openSubscriptionPage}>
                    <span>{t('header.subscription.open')}</span>
                    <MdWorkspacePremium size={18} />
                </button>
            ) : (
                <button className={menuStyles.contextButton} onClick={openBoostyUrl}>
                    <span>{t('contextMenu.boostyUrl')}</span>
                    <BoostyIcon size={18} />
                </button>
            ),
        ),
        createButtonSection(t('contextMenu.obsWidget.title'), [
            {
                label: t('contextMenu.obsWidget.download', {
                    status: widgetInstalled ? t('contextMenu.status.installed') : t('contextMenu.status.notInstalled'),
                }),
                onClick: downloadObsWidget,
                disabled: widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.openFolder'),
                onClick: openObsWidgetDirectory,
                disabled: !widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.copyPath'),
                onClick: copyWidgetPath,
                disabled: !widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.remove'),
                onClick: removeObsWidget,
                disabled: !widgetInstalled,
            },
        ]),
        createButtonSection(t('contextMenu.mod.title'), [
            {
                label:
                    app.mod.installed && app.mod.version
                        ? `${app.mod.name || t('contextMenu.mod.defaultName')} v${app.mod.version}`
                        : t('contextMenu.mod.notInstalled'),
                onClick: () => openModal(modals.MOD_CHANGELOG),
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.remove'),
                onClick: deleteMod,
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.checkUpdates'),
                onClick: checkModUpdates,
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.clearCache'),
                onClick: clearModCache,
            },
            ...(isLinux
                ? [
                      {
                          label: t('contextMenu.mod.resetAsarPath'),
                          onClick: resetAsarPath,
                          disabled: !canResetAsarPath,
                      },
                  ]
                : []),
            createToggleButton(t('contextMenu.mod.showChangelog'), app.settings.showModModalAfterInstall, () =>
                toggleSetting('showModModalAfterInstall', !app.settings.showModModalAfterInstall),
            ),
        ]),
        createButtonSection(t('contextMenu.updates.title'), [
            ...updateSourceButtons,
            {
                label: t('contextMenu.updates.channel'),
                onClick: openUpdateChannelModal,
                disabled: updateSourceSwitchBlocked,
            },
            {
                label: t('contextMenu.updates.checkAppUpdates'),
                onClick: checkAppUpdates,
            },
            {
                label: t('contextMenu.updates.checkModUpdates'),
                onClick: checkModUpdates,
            },
        ]),
        createButtonSection(t('contextMenu.appSettings.title'), [
            createToggleButton(t('contextMenu.appSettings.autoStartApp'), app.settings.autoStartApp, () =>
                toggleSetting('autoStart', !app.settings.autoStartApp),
            ),
            createToggleButton(t('contextMenu.appSettings.hardwareAcceleration'), app.settings.hardwareAcceleration, () =>
                toggleSetting('hardwareAcceleration', !app.settings.hardwareAcceleration),
            ),
            createToggleButton(t('contextMenu.appSettings.autoUpdateStoreAddons'), app.settings.autoUpdateStoreAddons, () =>
                toggleSetting('autoUpdateStoreAddons', !app.settings.autoUpdateStoreAddons),
            ),
            createToggleButton(t('contextMenu.appSettings.deletePextAfterImport'), app.settings.deletePextAfterImport, () =>
                toggleSetting('deletePextAfterImport', !app.settings.deletePextAfterImport),
            ),
        ]),
        createButtonSection(t('contextMenu.windowSettings.title'), [
            createToggleButton(t('contextMenu.windowSettings.saveWindowDimensions'), app.settings.saveWindowDimensionsOnRestart, () =>
                toggleSetting('saveWindowDimensionsOnRestart', !app.settings.saveWindowDimensionsOnRestart),
            ),
            createToggleButton(t('contextMenu.windowSettings.saveWindowPosition'), app.settings.saveWindowPositionOnRestart, () =>
                toggleSetting('saveWindowPositionOnRestart', !app.settings.saveWindowPositionOnRestart),
            ),
        ]),
        createButtonSection(t('contextMenu.traySettings.title'), [
            createToggleButton(t('contextMenu.traySettings.autoTray'), app.settings.autoStartInTray, () =>
                toggleSetting('autoTray', !app.settings.autoStartInTray),
            ),
            createToggleButton(t('contextMenu.traySettings.hideOnClose'), app.settings.closeAppInTray, () =>
                toggleSetting('closeAppInTray', !app.settings.closeAppInTray),
            ),
        ]),
        createButtonSection(t('contextMenu.language.title'), [
            createToggleButton(t('contextMenu.language.russian'), app.settings.language === 'ru', () => setLanguage('ru')),
            createToggleButton(t('contextMenu.language.english'), app.settings.language === 'en', () => setLanguage('en')),
        ]),
        createButtonSection(t('contextMenu.misc.title'), [
            { label: t('contextMenu.misc.version', { version: app.info.version, branch: appBranch }), onClick: openUpdateModal },
            {
                label: t('contextMenu.misc.collectLogs'),
                onClick: collectLogs,
            },
            createToggleButton(
                t('contextMenu.misc.websocketStatus'),
                app.settings.devSocket,
                () => {
                    toggleSetting('devSocket', !app.settings.devSocket)
                },
                true,
                false,
                isDevRuntime,
            ),
            {
                label: t('contextMenu.appDirectory'),
                onClick: openAppDirectory,
            },
        ]),
    ]
}

export function renderContextMenuSections(buttonConfigs: SectionConfig[]) {
    return buttonConfigs.map((section, index) => (
        <React.Fragment key={index}>
            {section.content ? (
                <div>{section.content}</div>
            ) : (
                <div className={menuStyles.innerFunction}>
                    {section.title && (
                        <>
                            {section.title}
                            <ArrowContext />
                        </>
                    )}
                    {section.buttons && (
                        <div className={menuStyles.showButtons}>
                            {section.buttons
                                ?.filter(Boolean)
                                .map((button, i) => (
                                    <button key={i} className={menuStyles.contextButton} onClick={button.onClick} disabled={button.disabled}>
                                        {button.label}
                                    </button>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </React.Fragment>
    ))
}
