import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            avatarHash
            status
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
