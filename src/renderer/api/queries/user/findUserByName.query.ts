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

            isFriend

            levelInfo {
                totalPoints
                currentLevel
                nextLevelThreshold
                pointsToNextLevel
            }

            userAchievements {
                id
                status
                progressCurrent
                progressTotal
                completedAt
                criteriaProgress {
                    id
                    name
                    isCompleted
                }
                achievement {
                    id
                    title
                    description
                    hint
                    imageUrl
                    type
                    difficulty
                    points
                    createdAt
                    progressCompleted
                    progressTotal
                }
            }
        }
    }
`
