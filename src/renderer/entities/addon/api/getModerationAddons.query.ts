import gql from 'graphql-tag'

export default gql`
    query GetModerationAddons($search: String, $status: String) {
        getModerationAddons(search: $search, status: $status) {
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
                usedAiDuringDevelopment
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
                usedAiDuringDevelopment
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
