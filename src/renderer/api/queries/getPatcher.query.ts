import gql from 'graphql-tag'

export default gql`
query GetPatcher {
    getPatcher {
        id
        version
        downloadUrl
        createdAt
    }
}
`
