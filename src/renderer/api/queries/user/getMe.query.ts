import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            avatar
            avatarHash
            status
            banner
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
