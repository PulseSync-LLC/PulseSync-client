import gql from 'graphql-tag'

export default gql`
    query GetStoreAddons(
        $page: Int = 1
        $pageSize: Int = 30
        $search: String
        $type: String
        $sortBy: String
        $sortOrder: String
    ) {
        getStoreAddons(page: $page, pageSize: $pageSize, search: $search, type: $type, sortBy: $sortBy, sortOrder: $sortOrder) {
            totalCount
            totalPages
            addons {
                id
                name
                type
                downloadCount
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
                    githubUrl
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
