import React from 'react'

import { useTranslation } from 'react-i18next'
import { MdCode, MdExtension, MdInfoOutline, MdInsights, MdLink, MdScience, MdSettings, MdSystemUpdateAlt, MdWidgets } from 'react-icons/md'

import DeveloperToolsPanel from '@features/developerTools/DeveloperToolsPanel'
import ExperimentOverridesPanel from '@features/developerTools/ExperimentOverridesPanel'

import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { useSettingsActions } from '@features/settings/model/useSettingsActions'
import type { DeveloperSetting, SettingsCategorySchema } from '@widgets/modalContainer/modals/SettingsModal/model/types'

type SettingsActions = ReturnType<typeof useSettingsActions>

interface UseSettingsSchemaOptions {
    actions: SettingsActions
    app: SettingsInterface
    canOverrideExperiments: boolean
    hasDeveloperSection: boolean
    isLocalDev: boolean
    onNavigate: (path: string) => void
    onUpdateDeveloperSetting: (setting: DeveloperSetting, checked: boolean) => void
}

export function useSettingsSchema({
    actions,
    app,
    canOverrideExperiments,
    hasDeveloperSection,
    isLocalDev,
    onNavigate,
    onUpdateDeveloperSetting,
}: UseSettingsSchemaOptions): SettingsCategorySchema[] {
    const { t } = useTranslation()
    const isModInstalled = app.mod.installed && Boolean(app.mod.version)
    const backendSelected = !actions.isAutonomousMode && actions.updateSource === 'backend'
    const githubSelected = actions.isAutonomousMode || actions.updateSource === 'github'
    const selectedModSource = actions.modSourceCatalog.selected
    const branchSourceItems = actions.modSourceCatalog.branches.map(build => ({
        id: `mod-source-branch-${build.branch}`,
        kind: 'choice' as const,
        label: build.branch,
        description: t('contextMenu.mod.experimentalBuild', {
            commit: build.commit.slice(0, 7),
            version: build.version,
        }),
        selected: selectedModSource.type === 'branch' && selectedModSource.branch === build.branch,
        disabled: actions.modSourceLoading,
        onSelect: () => void actions.setModSource({ type: 'branch', branch: build.branch }),
    }))

    if (selectedModSource.type === 'branch' && !actions.modSourceCatalog.branches.some(build => build.branch === selectedModSource.branch)) {
        branchSourceItems.push({
            id: `mod-source-branch-${selectedModSource.branch}`,
            kind: 'choice',
            label: selectedModSource.branch,
            description: t('contextMenu.mod.branchUnavailable'),
            selected: true,
            disabled: true,
            onSelect: () => {},
        })
    }

    const categories: SettingsCategorySchema[] = [
        {
            id: 'application',
            label: t('settingsModal.category'),
            sections: [
                {
                    id: 'general',
                    icon: MdSettings,
                    label: t('settingsModal.sections.general'),
                    title: t('settingsModal.sections.general'),
                    content: {
                        kind: 'groups',
                        groups: [
                            {
                                id: 'application',
                                title: t('contextMenu.appSettings.title'),
                                items: [
                                    {
                                        id: 'auto-start',
                                        kind: 'toggle',
                                        label: t('contextMenu.appSettings.autoStartApp'),
                                        checked: app.settings.autoStartApp,
                                        onChange: checked => actions.toggleSetting('autoStart', checked),
                                    },
                                    {
                                        id: 'hardware-acceleration',
                                        kind: 'toggle',
                                        label: t('contextMenu.appSettings.hardwareAcceleration'),
                                        checked: app.settings.hardwareAcceleration,
                                        onChange: checked => actions.toggleSetting('hardwareAcceleration', checked),
                                    },
                                    {
                                        id: 'auto-update-store-addons',
                                        kind: 'toggle',
                                        label: t('contextMenu.appSettings.autoUpdateStoreAddons'),
                                        checked: app.settings.autoUpdateStoreAddons,
                                        onChange: checked => actions.toggleSetting('autoUpdateStoreAddons', checked),
                                    },
                                    {
                                        id: 'delete-pext-after-import',
                                        kind: 'toggle',
                                        label: t('contextMenu.appSettings.deletePextAfterImport'),
                                        checked: app.settings.deletePextAfterImport,
                                        onChange: checked => actions.toggleSetting('deletePextAfterImport', checked),
                                    },
                                    ...(app.info.devmark
                                        ? [
                                              {
                                                  id: 'show-dev-frame',
                                                  kind: 'toggle' as const,
                                                  label: t('contextMenu.misc.showDevFrame'),
                                                  description: t('settingsModal.developer.showDevFrameDescription'),
                                                  checked: app.settings.showDevFrame,
                                                  onChange: (checked: boolean) => onUpdateDeveloperSetting('showDevFrame', checked),
                                              },
                                          ]
                                        : []),
                                ],
                            },
                            {
                                id: 'window',
                                title: t('contextMenu.windowSettings.title'),
                                items: [
                                    {
                                        id: 'save-window-dimensions',
                                        kind: 'toggle',
                                        label: t('contextMenu.windowSettings.saveWindowDimensions'),
                                        checked: app.settings.saveWindowDimensionsOnRestart,
                                        onChange: checked => actions.toggleSetting('saveWindowDimensionsOnRestart', checked),
                                    },
                                    {
                                        id: 'save-window-position',
                                        kind: 'toggle',
                                        label: t('contextMenu.windowSettings.saveWindowPosition'),
                                        checked: app.settings.saveWindowPositionOnRestart,
                                        onChange: checked => actions.toggleSetting('saveWindowPositionOnRestart', checked),
                                    },
                                ],
                            },
                            {
                                id: 'tray',
                                title: t('contextMenu.traySettings.title'),
                                items: [
                                    {
                                        id: 'auto-tray',
                                        kind: 'toggle',
                                        label: t('contextMenu.traySettings.autoTray'),
                                        checked: app.settings.autoStartInTray,
                                        onChange: checked => actions.toggleSetting('autoTray', checked),
                                    },
                                    {
                                        id: 'close-to-tray',
                                        kind: 'toggle',
                                        label: t('contextMenu.traySettings.hideOnClose'),
                                        checked: app.settings.closeAppInTray,
                                        onChange: checked => actions.toggleSetting('closeAppInTray', checked),
                                    },
                                ],
                            },
                            {
                                id: 'language',
                                title: t('contextMenu.language.title'),
                                items: [
                                    {
                                        id: 'language-ru',
                                        kind: 'toggle',
                                        label: t('contextMenu.language.russian'),
                                        checked: app.settings.language === 'ru',
                                        onChange: () => void actions.setLanguage('ru'),
                                    },
                                    {
                                        id: 'language-en',
                                        kind: 'toggle',
                                        label: t('contextMenu.language.english'),
                                        checked: app.settings.language === 'en',
                                        onChange: () => void actions.setLanguage('en'),
                                    },
                                ],
                            },
                        ],
                    },
                },
                {
                    id: 'integrations',
                    icon: MdExtension,
                    label: t('settingsModal.sections.integrations'),
                    title: t('settingsModal.sections.integrations'),
                    content: {
                        kind: 'groups',
                        groups: [
                            {
                                id: 'subscription',
                                title: t('settingsModal.subscription'),
                                items: [
                                    actions.subscriptionPageEnabled
                                        ? {
                                              id: 'open-subscription',
                                              kind: 'action',
                                              label: t('header.subscription.open'),
                                              onClick: actions.openSubscriptionPage,
                                          }
                                        : {
                                              id: 'open-boosty',
                                              kind: 'action',
                                              label: t('contextMenu.boostyUrl'),
                                              onClick: actions.openBoostyUrl,
                                          },
                                ],
                            },
                            {
                                id: 'obs-widget',
                                title: t('contextMenu.obsWidget.title'),
                                meta: t(actions.widgetInstalled ? 'settingsModal.status.installed' : 'settingsModal.status.notInstalled'),
                                items: [
                                    {
                                        id: 'download-obs-widget',
                                        kind: 'action',
                                        label: t('contextMenu.obsWidget.download', {
                                            status: t(actions.widgetInstalled ? 'contextMenu.status.installed' : 'contextMenu.status.notInstalled'),
                                        }),
                                        disabled: actions.widgetInstalled,
                                        onClick: actions.downloadObsWidget,
                                    },
                                    {
                                        id: 'open-obs-widget-directory',
                                        kind: 'action',
                                        label: t('contextMenu.obsWidget.openFolder'),
                                        disabled: !actions.widgetInstalled,
                                        onClick: actions.openObsWidgetDirectory,
                                    },
                                    {
                                        id: 'copy-obs-widget-path',
                                        kind: 'action',
                                        label: t('contextMenu.obsWidget.copyPath'),
                                        disabled: !actions.widgetInstalled,
                                        onClick: () => void actions.copyWidgetPath(),
                                    },
                                    {
                                        id: 'remove-obs-widget',
                                        kind: 'action',
                                        label: t('contextMenu.obsWidget.remove'),
                                        disabled: !actions.widgetInstalled,
                                        onClick: actions.removeObsWidget,
                                    },
                                ],
                            },
                            {
                                id: 'mod-version',
                                title: t('contextMenu.mod.version'),
                                items: [
                                    {
                                        id: 'mod-source-stable',
                                        kind: 'choice',
                                        label: t('contextMenu.mod.stable'),
                                        description: t('contextMenu.mod.stableDescription'),
                                        selected: selectedModSource.type === 'stable',
                                        disabled: actions.modSourceLoading,
                                        onSelect: () => void actions.setModSource({ type: 'stable', branch: '' }),
                                    },
                                ],
                            },
                            ...(branchSourceItems.length
                                ? [
                                      {
                                          id: 'mod-test-versions',
                                          title: t('contextMenu.mod.testVersions'),
                                          items: branchSourceItems,
                                      },
                                  ]
                                : []),
                            {
                                id: 'mod',
                                title: t('contextMenu.mod.title'),
                                meta: isModInstalled
                                    ? `${app.mod.name || t('contextMenu.mod.defaultName')} v${app.mod.version}`
                                    : t('contextMenu.mod.notInstalled'),
                                items: [
                                    {
                                        id: 'open-mod-changelog',
                                        kind: 'action',
                                        label: t('settingsModal.actions.changelog'),
                                        disabled: !isModInstalled,
                                        onClick: actions.openModChangelog,
                                    },
                                    {
                                        id: 'remove-mod',
                                        kind: 'action',
                                        label: t('contextMenu.mod.remove'),
                                        disabled: !isModInstalled,
                                        onClick: actions.deleteMod,
                                    },
                                    {
                                        id: 'check-mod-updates',
                                        kind: 'action',
                                        label: t('contextMenu.mod.checkUpdates'),
                                        disabled: !isModInstalled,
                                        onClick: actions.checkModUpdates,
                                    },
                                    {
                                        id: 'clear-mod-cache',
                                        kind: 'action',
                                        label: t('contextMenu.mod.clearCache'),
                                        onClick: actions.clearModCache,
                                    },
                                    ...(actions.isLinux
                                        ? [
                                              {
                                                  id: 'reset-asar-path',
                                                  kind: 'action' as const,
                                                  label: t('contextMenu.mod.resetAsarPath'),
                                                  disabled: !actions.canResetAsarPath,
                                                  onClick: actions.resetAsarPath,
                                              },
                                          ]
                                        : []),
                                    {
                                        id: 'show-mod-changelog',
                                        kind: 'toggle',
                                        label: t('contextMenu.mod.showChangelog'),
                                        checked: app.settings.showModModalAfterInstall,
                                        onChange: checked => actions.toggleSetting('showModModalAfterInstall', checked),
                                    },
                                ],
                            },
                        ],
                    },
                },
                {
                    id: 'updates',
                    icon: MdSystemUpdateAlt,
                    label: t('contextMenu.updates.title'),
                    title: t('contextMenu.updates.title'),
                    content: {
                        kind: 'groups',
                        groups: [
                            {
                                id: 'update-source',
                                title: t('settingsModal.updateSource'),
                                items: [
                                    {
                                        id: 'update-source-backend',
                                        kind: 'toggle',
                                        label: t('contextMenu.updates.sourceBackend'),
                                        checked: backendSelected,
                                        disabled: actions.isAutonomousMode || actions.updateSourceSwitchBlocked,
                                        onChange: () => void actions.setReleaseSource('backend'),
                                    },
                                    {
                                        id: 'update-source-github',
                                        kind: 'toggle',
                                        label: t('contextMenu.updates.sourceGithub'),
                                        checked: githubSelected,
                                        disabled: actions.isAutonomousMode || actions.updateSourceSwitchBlocked,
                                        onChange: () => void actions.setReleaseSource('github'),
                                    },
                                ],
                            },
                            {
                                id: 'update-actions',
                                title: t('settingsModal.actions.title'),
                                items: [
                                    {
                                        id: 'open-update-channel',
                                        kind: 'action',
                                        label: t('contextMenu.updates.channel'),
                                        disabled: actions.updateSourceSwitchBlocked,
                                        onClick: actions.openUpdateChannelModal,
                                    },
                                    {
                                        id: 'check-app-updates',
                                        kind: 'action',
                                        label: t('contextMenu.updates.checkAppUpdates'),
                                        onClick: actions.checkAppUpdates,
                                    },
                                    {
                                        id: 'check-mod-updates',
                                        kind: 'action',
                                        label: t('contextMenu.updates.checkModUpdates'),
                                        onClick: actions.checkModUpdates,
                                    },
                                ],
                            },
                        ],
                    },
                },
                {
                    id: 'system',
                    icon: MdInfoOutline,
                    label: t('contextMenu.misc.title'),
                    title: t('contextMenu.misc.title'),
                    content: {
                        kind: 'groups',
                        groups: [
                            {
                                id: 'application-info',
                                title: t('settingsModal.application'),
                                meta: `v${app.info.version} · #${app.info.branch}`,
                                items: [
                                    {
                                        id: 'open-app-changelog',
                                        kind: 'action',
                                        label: t('settingsModal.actions.changelog'),
                                        onClick: actions.openAppChangelog,
                                    },
                                    {
                                        id: 'collect-logs',
                                        kind: 'action',
                                        label: t('contextMenu.misc.collectLogs'),
                                        onClick: actions.collectLogs,
                                    },
                                    {
                                        id: 'open-app-directory',
                                        kind: 'action',
                                        label: t('contextMenu.appDirectory'),
                                        onClick: actions.openAppDirectory,
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
    ]

    if (hasDeveloperSection) {
        categories.push({
            id: 'developer',
            label: t('settingsModal.developer.category'),
            sections: [
                {
                    id: 'developer',
                    icon: MdCode,
                    label: t('settingsModal.developer.settingsTab'),
                    title: t('settingsModal.developer.title'),
                    content: {
                        kind: 'groups',
                        groups: isLocalDev
                            ? [
                                  {
                                      id: 'developer-runtime',
                                      title: t('settingsModal.developer.runtimeTitle'),
                                      items: [
                                          {
                                              id: 'developer-websocket',
                                              kind: 'toggle',
                                              label: t('contextMenu.misc.websocketStatus'),
                                              description: t('settingsModal.developer.websocketDescription'),
                                              checked: app.settings.devSocket,
                                              onChange: checked => onUpdateDeveloperSetting('devSocket', checked),
                                          },
                                      ],
                                  },
                              ]
                            : [],
                    },
                },
                ...(canOverrideExperiments
                    ? [
                          {
                              id: 'experiments' as const,
                              icon: MdScience,
                              label: t('header.devOverrides.title'),
                              title: t('header.devOverrides.title'),
                              content: {
                                  kind: 'custom' as const,
                                  node: <ExperimentOverridesPanel />,
                              },
                          },
                      ]
                    : []),
                {
                    id: 'metrics',
                    icon: MdInsights,
                    label: t('dev.sections.metrics'),
                    title: t('dev.sections.metrics'),
                    content: {
                        kind: 'custom',
                        node: <DeveloperToolsPanel section="metrics" onNavigate={onNavigate} />,
                    },
                },
                {
                    id: 'components',
                    icon: MdWidgets,
                    label: t('settingsModal.developer.componentsTitle'),
                    title: t('settingsModal.developer.componentsTitle'),
                    content: {
                        kind: 'custom',
                        node: <DeveloperToolsPanel section="components" onNavigate={onNavigate} />,
                    },
                },
                {
                    id: 'navigation',
                    icon: MdLink,
                    label: t('dev.sections.navigation'),
                    title: t('dev.sections.navigation'),
                    content: {
                        kind: 'custom',
                        node: <DeveloperToolsPanel section="navigation" onNavigate={onNavigate} />,
                    },
                },
            ],
        })
    }

    return categories
}
