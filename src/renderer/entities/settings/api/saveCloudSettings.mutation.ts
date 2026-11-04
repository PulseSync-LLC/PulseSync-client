import gql from 'graphql-tag'

import CloudSettingsFields from './cloudSettings.fragment'

export default gql`
    mutation SaveCloudSettings($input: CloudSettingsInput!) {
        saveCloudSettings(input: $input) {
            ...CloudSettingsFields
        }
    }
    ${CloudSettingsFields}
`
