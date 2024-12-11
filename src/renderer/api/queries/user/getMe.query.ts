import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            avatar
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
