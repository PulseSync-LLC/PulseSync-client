import gql from 'graphql-tag'

export default gql`
    query GetOwnStoreAddons {
        getOwnStoreAddons {
            id
            name
            type
            submittedById
            submittedByUsername
            submittedByNickname
            currentRelease {
                id
                version
                description
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
            releases {
                id
                version
                description
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
            createdAt
            updatedAt
        }
    }
`
