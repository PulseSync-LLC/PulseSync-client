import gql from 'graphql-tag'

export default gql`
    query GetAddonWhitelist {
        getAddonWhitelist {
            id
            name
            supported
        }
    }
`
