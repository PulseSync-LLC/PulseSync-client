import gql from 'graphql-tag'

export default gql`
    query GetStoreAddons($page: Int = 1, $pageSize: Int = 30) {
        getStoreAddons(page: $page, pageSize: $pageSize) {
            totalCount
            totalPages
            addons {
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
    }
`
