import gql from 'graphql-tag'

import CloudSettingsFields from './cloudSettings.fragment'

export default gql`
    mutation SetCloudSettingsEnabled($enabled: Boolean!, $input: CloudSettingsInput) {
        setCloudSettingsEnabled(enabled: $enabled, input: $input) {
            ...CloudSettingsFields
        }
    }
    ${CloudSettingsFields}
`
