import gql from "graphql-tag";

export default gql`
    query GetAllUsers(
        $page: Int!
        $perPage: Int!
        $sorting: [SortOptionInput!]
    ) {
        getUsersWithPagination(
            page: $page
            pageSize: $perPage
            sortOptions: $sorting
        ) {
            totalCount
            totalPages

            users {
                id
                avatar
                username
                createdAt
                banner
                perms
                status
                ban {
                    uuid
                    createdAt
                }
            }
        }
    }
`;
