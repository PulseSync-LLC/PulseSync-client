import gql from 'graphql-tag'

export default gql`
    query GetAllUsers(
        $page: Int!
        $perPage: Int!
        $sorting: [SortOptionInput!]
        $search: String
    ) {
        getUsersWithPagination(
            page: $page
            pageSize: $perPage
            sortOptions: $sorting
            search: $search
        ) {
            totalCount
            totalPages

            users {
                id
                avatarHash
                username
                createdAt
                bannerHash
                perms
                status
                ban {
                    uuid
                    createdAt
                }
                badges {
                    name
                    type
                    level
                    createdAt
                }
            }
        }
    }
`
