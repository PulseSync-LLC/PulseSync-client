const fields = 'version enabled revision settings addons'

export const GET_CLOUD_SETTINGS = `query GetCloudSettings { getMeWeb { id } getCloudSettings { ${fields} } }`
export const SAVE_CLOUD_SETTINGS = `mutation SaveCloudSettings($input: CloudSettingsInput!) { saveCloudSettings(input: $input) { ${fields} } }`
export const SET_CLOUD_SETTINGS_ENABLED = `mutation SetCloudSettingsEnabled($enabled: Boolean!, $input: CloudSettingsInput) {
    setCloudSettingsEnabled(enabled: $enabled, input: $input) { ${fields} }
}`
