import gql from 'graphql-tag';


export const GET_USER_ACHIEVEMENTS = gql`
    query GetUserAchievements($userId: String!) {
        getUserAchievements(userId: $userId) {
            id
            achievement {
                id
                title
                description
                difficulty
                points
            }
            progressCurrent
            progressTotal
            status
        }
    }
`;

export const AWARD_ACHIEVEMENT = gql`
    mutation AwardAchievement($userId: String!, $achievementId: ID!, $progressTotal: Int!) {
        awardAchievement(userId: $userId, achievementId: $achievementId, progressTotal: $progressTotal) {
            id
            achievement {
                id
                title
            }
            progressCurrent
            progressTotal
            status
        }
    }
`;

export const UPDATE_ACHIEVEMENT_PROGRESS = gql`
    mutation UpdateAchievementProgress($userAchievementId: String!, $progressCurrent: Int!) {
        updateAchievementProgress(userAchievementId: $userAchievementId, progressCurrent: $progressCurrent) {
            id
            progressCurrent
            progressTotal
            status
        }
    }
`;

export const REMOVE_USER_ACHIEVEMENT = gql`
    mutation RemoveUserAchievement($userAchievementId: String!) {
        removeUserAchievement(userAchievementId: $userAchievementId)
    }
`;
