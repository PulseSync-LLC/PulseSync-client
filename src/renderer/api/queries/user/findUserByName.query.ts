import gql from 'graphql-tag'

export default gql`
    query findUserByName($name: String!) {
        findUserByName(name: $name) {
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
