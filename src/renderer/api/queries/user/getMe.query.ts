import gql from 'graphql-tag'

export default gql`
    query users {
        getMe {
            id
            username
            nickname
            perms
            createdAt
            ban {
                uuid
                createdAt
            }
            avatarHash
            avatarType
            bannerHash
            bannerType
            badges {
                uuid
                name
                type
                level
            }
            status
            lastOnline
            currentTrack
        }
    }
`
