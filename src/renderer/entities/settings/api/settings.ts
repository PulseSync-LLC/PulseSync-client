import SettingsInterface from '@entities/settings/model/settings.interface'
import React from 'react'
import settingsInitials from '@entities/settings/model/settings.initials'
import { desktopApi } from '@shared/desktop/desktopApi'

export const fetchSettings = async (setApp: React.Dispatch<React.SetStateAction<SettingsInterface>>): Promise<void> => {
    const [snapshot, token, runtimeInfo] = await Promise.all([
        desktopApi.settings.getSnapshot(),
        desktopApi.auth.getToken(),
        desktopApi.getRuntimeInfo(),
    ])
    const config: SettingsInterface = {
        ...settingsInitials,
        settings: {
            ...settingsInitials.settings,
            ...snapshot.settings,
        },
        mod: {
            ...settingsInitials.mod,
            ...snapshot.mod,
        },
        tokens: {
            ...settingsInitials.tokens,
            token,
        },
        info: {
            ...settingsInitials.info,
            version: runtimeInfo.clientVersion,
            branch: runtimeInfo.buildIdentity.commit,
            devmark: runtimeInfo.isDev || runtimeInfo.buildChannel === 'dev',
        },
    }
    setApp(config)
}
