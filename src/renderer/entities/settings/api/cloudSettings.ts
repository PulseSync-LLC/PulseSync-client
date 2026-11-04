import apolloClient from '@shared/api/apolloClient'

import GetCloudSettings from './getCloudSettings.query'
import SaveCloudSettings from './saveCloudSettings.mutation'
import SetCloudSettingsEnabled from './setCloudSettingsEnabled.mutation'

import type { CloudSettingsSnapshot, CloudSettingsState } from '@common/cloudSettings'

type SnapshotInput = CloudSettingsSnapshot & { revision: number }
const context = (token: string) => ({ authToken: token, fetchOptions: { signal: AbortSignal.timeout(15_000) } })

export const getCloudSettings = async (token: string, userId: string): Promise<CloudSettingsState> => {
    const result = await apolloClient.query<{ getMeWeb: { id: string } | null; getCloudSettings: CloudSettingsState }>({
        query: GetCloudSettings,
        fetchPolicy: 'no-cache',
        context: context(token),
    })
    if (result.data?.getMeWeb?.id !== userId || !result.data?.getCloudSettings) throw new Error('CLOUD_SETTINGS_SESSION_CHANGED')
    return result.data.getCloudSettings
}

export const setCloudSettingsEnabled = async (token: string, enabled: boolean, input?: SnapshotInput): Promise<CloudSettingsState> => {
    const result = await apolloClient.mutate<{ setCloudSettingsEnabled: CloudSettingsState }>({
        mutation: SetCloudSettingsEnabled,
        variables: { enabled, input },
        fetchPolicy: 'no-cache',
        context: context(token),
    })
    if (!result.data?.setCloudSettingsEnabled) throw new Error('CLOUD_SETTINGS_EMPTY_RESPONSE')
    return result.data.setCloudSettingsEnabled
}

export const saveCloudSettings = async (token: string, input: SnapshotInput): Promise<CloudSettingsState> => {
    const result = await apolloClient.mutate<{ saveCloudSettings: CloudSettingsState }>({
        mutation: SaveCloudSettings,
        variables: { input },
        fetchPolicy: 'no-cache',
        context: context(token),
    })
    if (!result.data?.saveCloudSettings) throw new Error('CLOUD_SETTINGS_EMPTY_RESPONSE')
    return result.data.saveCloudSettings
}
