import gql from 'graphql-tag'

export default gql`
    query GetModerationAddons($search: String, $status: String, $type: String, $sortBy: String, $sortOrder: String) {
        getModerationAddons(search: $search, status: $status, type: $type, sortBy: $sortBy, sortOrder: $sortOrder) {
            id
            name
            type
            downloadCount
            ratingAverage
            ratingCount
            myRating
            submittedById
            submittedByUsername
            submittedByNickname
            currentRelease {
                id
                version
                description
                authors
                changelog
                tags
                usedAiDuringDevelopment
                usesOfficialTemplate
                avatarUrl
                bannerUrl
                bannerLeftColor
                bannerRightColor
                downloadUrl
                approvedAt
                assetsPurgedAt
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
