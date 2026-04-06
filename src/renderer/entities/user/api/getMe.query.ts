import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
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
        }
    }
`
