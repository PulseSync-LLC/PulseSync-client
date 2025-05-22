import { gql } from '@apollo/client'

export default gql`
    subscription GetAllUsersSubscription($page: Int!, $perPage: Int!, $sorting: [SortOptionInput!], $search: String) {
        subscribeUsersWithPagination(page: $page, pageSize: $perPage, sortOptions: $sorting, search: $search) {
            totalCount
            totalPages
            users {
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
                    name
                    type
                    level
                    createdAt
                }
                levelInfo {
                    totalPoints
                    currentLevel
                    progressInCurrentLevel
                    currentLevelThreshold
                }
            }
        }
    }
`
