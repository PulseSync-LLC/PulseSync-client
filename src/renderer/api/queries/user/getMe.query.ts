import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            avatar
            avatarHash
            status
            banner
            bannerHash
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
