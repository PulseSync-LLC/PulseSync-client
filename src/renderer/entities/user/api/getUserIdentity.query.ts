import { gql } from '@apollo/client'

export interface UserIdentity {
    id: string
    nickname: string | null
    username: string
    avatarHash: string | null
    avatarType: string | null
}

export interface GetUserIdentityData {
    findUserById: UserIdentity | null
}

export default gql`
    query GetUserIdentity($id: String!) {
        findUserById(id: $id) {
            id
            nickname
            username
            avatarHash
            avatarType
        }
    }
`
