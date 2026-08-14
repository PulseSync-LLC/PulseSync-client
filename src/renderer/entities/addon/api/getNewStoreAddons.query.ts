import gql from 'graphql-tag'

export default gql`
    query GetNewStoreAddons($pageSize: Int = 12, $search: String) {
        getStoreAddons(page: 1, pageSize: $pageSize, search: $search, sortBy: "publishedAt", sortOrder: "desc") {
            totalCount
            totalPages
            addons {
                id
                name
                type
                downloadCount
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
                    downloadUrl
                    githubUrl
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
    }
`
