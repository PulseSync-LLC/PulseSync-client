import gql from 'graphql-tag'

export default gql`
    query GetOwnStoreAddons {
        getOwnStoreAddons {
            id
            name
            type
            downloadCount
            submittedById
            submittedByUsername
            submittedByNickname
            currentRelease {
                id
                version
                description
                authors
                changelog
                tags
                usedAiDuringDevelopment
                usesOfficialTemplate
                avatarUrl
                bannerUrl
                downloadUrl
                githubUrl
                approvedAt
                status
                moderationNote
                createdAt
                updatedAt
            }
            releases {
                id
                version
                description
                authors
                changelog
                tags
                usedAiDuringDevelopment
                usesOfficialTemplate
                avatarUrl
                bannerUrl
                downloadUrl
                githubUrl
                approvedAt
                status
                moderationNote
                createdAt
                updatedAt
            }
            createdAt
            updatedAt
        }
    }
`
