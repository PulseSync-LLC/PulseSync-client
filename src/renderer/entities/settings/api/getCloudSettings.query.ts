import gql from 'graphql-tag'

import CloudSettingsFields from './cloudSettings.fragment'

export default gql`
    query GetCloudSettings {
        getMeWeb {
            id
        }
        getCloudSettings {
            ...CloudSettingsFields
        }
    }
    ${CloudSettingsFields}
`
