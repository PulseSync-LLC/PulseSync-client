import gql from 'graphql-tag'

export default gql`
    query GetModerationAddons($search: String, $status: String, $type: String, $sortBy: String, $sortOrder: String) {
        getModerationAddons(search: $search, status: $status, type: $type, sortBy: $sortBy, sortOrder: $sortOrder) {
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
            createdAt
            updatedAt
        }
    }
`
