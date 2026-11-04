import gql from 'graphql-tag'

export default gql`
    fragment CloudSettingsFields on CloudSettingsPayload {
        version
        enabled
        revision
        settings
        addons
    }
`
