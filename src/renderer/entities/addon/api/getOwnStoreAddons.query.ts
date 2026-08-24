import gql from 'graphql-tag'

export default gql`
    query GetOwnStoreAddons {
        getOwnStoreAddons {
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
                previewUrl
                bannerLeftColor
                bannerRightColor
                downloadUrl
                githubUrl
                approvedAt
                assetsPurgedAt
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
                tags
                usedAiDuringDevelopment
                usesOfficialTemplate
                avatarUrl
                bannerUrl
                previewUrl
                bannerLeftColor
                bannerRightColor
                downloadUrl
                githubUrl
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
