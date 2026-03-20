import gql from 'graphql-tag'

export default gql`
    query GetOwnStoreAddons {
        getOwnStoreAddons {
            id
            name
            description
            type
            version
            authors
            changelog
            avatarUrl
            bannerUrl
            downloadUrl
            approvedAt
            status
            moderationNote
            createdAt
            updatedAt
        }
    }
`
