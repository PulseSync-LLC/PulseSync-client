import gql from 'graphql-tag'

export default gql`
    query GetStoreAddons($page: Int = 1, $pageSize: Int = 30) {
        getStoreAddons(page: $page, pageSize: $pageSize) {
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
    }
`
