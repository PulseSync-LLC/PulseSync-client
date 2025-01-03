import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            avatarHash
            avatarType
            status
            bannerHash
            bannerType
            username
            nickname
            perms
            id
            createdAt
            badges {
                uuid
                name
                type
                level
            }
        }
    }
`
