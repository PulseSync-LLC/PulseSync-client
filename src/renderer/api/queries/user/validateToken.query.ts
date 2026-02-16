import { gql } from '@apollo/client'

const GET_USER_PROFILE_QUERY = gql`
    query GetUserProfile($name: String!, $page: Int!, $pageSize: Int!, $search: String, $sortOptions: [SortOptionInput!]) {
        findUserByName(name: $name) {
            id
            username
            nickname
            createdAt
            bannerHash
            bannerType
            avatarHash
            avatarType
            levelInfo {
                totalPoints
                currentLevel
                progressInCurrentLevel
                currentLevelThreshold
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
        getAchievements(page: $page, pageSize: $pageSize, search: $search, sortOptions: $sortOptions) {
            achievements {
                id
                title
                description
                imageUrl
                progressTotal
                points
                difficulty
                hint
            }
        }
    }
`

export default GET_USER_PROFILE_QUERY

