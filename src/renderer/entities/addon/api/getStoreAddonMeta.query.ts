import gql from 'graphql-tag'

export default gql`
    query GetStoreAddonMeta($id: String!) {
        getStoreAddonMeta(id: $id) {
            readme
        }
    }
`
