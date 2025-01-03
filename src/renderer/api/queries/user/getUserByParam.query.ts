import gql from 'graphql-tag'

export default gql`
    query GetUserByParam($param: String!) {
        getUserByParam(param: $param) {
            id
            username
            nickname
            avatarHash
            avatarType
            bannerHash
            bannerType
            status
            createdAt
            ban {
                uuid
                createdAt
            }
            badges {
                uuid
                name
                type
                level
            }
        }
    }
`
