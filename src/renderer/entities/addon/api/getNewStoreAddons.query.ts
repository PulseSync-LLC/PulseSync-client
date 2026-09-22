import gql from 'graphql-tag'

export default gql`
    query GetNewStoreAddons($pageSize: Int = 12, $search: String, $releaseChannel: String) {
        getStoreAddons(page: 1, pageSize: $pageSize, search: $search, sortBy: "publishedAt", sortOrder: "desc", releaseChannel: $releaseChannel) {
            totalCount
            totalPages
            addons {
                id
                name
                type
                downloadCount
                ratingAverage
                ratingCount
                myRating
                submittedById
                currentRelease {
                    id
                    version
                    visibility
                    releaseChannels
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
    }
`
