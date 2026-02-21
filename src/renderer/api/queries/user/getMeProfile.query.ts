import { gql } from '@apollo/client'

const GET_ME_PROFILE_QUERY = gql`
    query GetMeProfile {
        getMeProfile(newCalc: true) {
            id
            username
            nickname
            createdAt
            bannerHash
            bannerType
            avatarHash
            avatarType
            levelInfoV2 {
                totalPoints
            }
            badges {
                uuid
                name
                type
                level
            }
            userAchievements {
                achievement {
                    id
                }
                status
                progressCurrent
                progressTotal
                completedAt
                criteriaProgress {
                    id
                    name
                    isCompleted
                }
            }
            status
            currentTrack
            isFriend
            isFollowing
        }
    }
`

export default GET_ME_PROFILE_QUERY
