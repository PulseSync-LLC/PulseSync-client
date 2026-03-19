import { gql, TypedDocumentNode } from '@apollo/client'

type ToggleFollowData = { toggleFollow: { isFollowing: boolean; areFriends: boolean } }
type ToggleFollowVars = { targetId: string }

const TOGGLE_FOLLOW: TypedDocumentNode<ToggleFollowData, ToggleFollowVars> = gql`
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

export default TOGGLE_FOLLOW
