import gql from 'graphql-tag'

const UserListFields = gql`
    fragment UserListFields on SanitizedUserNew {
        id
        avatarHash
        avatarType
        nickname
        username
        createdAt
        bannerHash
        bannerType
        perms
        status
        lastOnline
        currentTrack
        ban {
            uuid
            createdAt
        }
        badges {
            uuid
            name
            type
            level
            createdAt
        }
        subscription {
            uuid
            name
            type
            createdAt
            expireAt
        }
        levelInfoV2 {
            totalPoints
        }
    }
`

export const GetUsersFirstPageQuery = gql`
    query GetUsersFirstPage($page: Int!, $perPage: Int!, $sorting: [SortOptionInput!], $search: String, $after: String) {
        getUsersWithPagination(newCalc: true, page: $page, pageSize: $perPage, sortOptions: $sorting, search: $search, after: $after) {
            totalPages
            hasMore
            endCursor
            users {
                ...UserListFields
            }
        }
    }
    ${UserListFields}
`

export const GetUsersNextPageQuery = gql`
    query GetUsersNextPage($page: Int!, $perPage: Int!, $sorting: [SortOptionInput!], $search: String, $after: String) {
        getUsersWithPagination(newCalc: true, page: $page, pageSize: $perPage, sortOptions: $sorting, search: $search, after: $after) {
            hasMore
            endCursor
            users {
                ...UserListFields
            }
        }
    }
    ${UserListFields}
`

export default gql`
    query GetAllUsers($page: Int!, $perPage: Int!, $sorting: [SortOptionInput!], $search: String) {
        getUsersWithPagination(newCalc: true, page: $page, pageSize: $perPage, sortOptions: $sorting, search: $search) {
            totalPages
            users {
                ...UserListFields
            }
        }
    }
    ${UserListFields}
`
