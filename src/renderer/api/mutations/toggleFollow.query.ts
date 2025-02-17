import gql from 'graphql-tag'

export default gql`
    mutation ToggleFollow($targetId: ID!) {
        toggleFollow(targetId: $targetId) {
            user {
                id
                username
            }
            isFollowing
            areFriends
        }
    }
`
