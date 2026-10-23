import gql from 'graphql-tag'

export default gql`
    query SearchUsers($search: String!) {
        getUsersWithPagination(page: 1, pageSize: 20, sortOptions: [{ id: "username", desc: false }], search: $search) {
            users {
                id
                username
                nickname
            }
        }
    }
`
