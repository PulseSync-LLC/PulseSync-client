import { createCloudSettingsSynchronizer } from '@common/cloudSettingsSync'
import { getCloudSettings, saveCloudSettings, setCloudSettingsEnabled } from '@entities/settings/api/cloudSettings'
import { desktopApi } from '@shared/desktop/desktopApi'

const synchronizeLegacyCloudSettings = createCloudSettingsSynchronizer({ desktopApi, getCloudSettings, saveCloudSettings, setCloudSettingsEnabled })

export const synchronizeCloudSettings: typeof synchronizeLegacyCloudSettings = async (userId, enabled, onStatus) => {
    if (!desktopApi.background) return synchronizeLegacyCloudSettings(userId, enabled, onStatus)
    const status = await desktopApi.background.synchronizeCloud(userId, enabled)
    onStatus?.(status)
    return status
}
