import gql from 'graphql-tag'

export default gql`
    query GetStoreAddonMeta($id: String!, $releaseChannel: String) {
        getStoreAddonMeta(id: $id, releaseChannel: $releaseChannel) {
            readme
        }
    }
`
