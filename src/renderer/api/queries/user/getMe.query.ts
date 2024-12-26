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
