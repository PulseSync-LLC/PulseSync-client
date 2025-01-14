import gql from 'graphql-tag'

export default gql`
    query findUserByName($name: String!) {
        findUserByName(name: $name) {
            id
            avatarHash
            avatarType
            username
            nickname
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
        }
    }
`
