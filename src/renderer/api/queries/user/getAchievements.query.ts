import gql from 'graphql-tag'

export default gql`
    query GetAchievements(
        $page: Int!
        $pageSize: Int!
        $search: String
        $sortOptions: [SortOptionInput!]
    ) {
        getAchievements(
            page: $page
            pageSize: $pageSize
            search: $search
            sortOptions: $sortOptions
        ) {
            achievements {
                id
                title
                description
                hint
                imageUrl
                points
                difficulty
                progressTotal
                progressCompleted
                criteria {
                    id
                    isCompleted
                    name
                }
                type
            }
            totalCount
            totalPages
        }
    }
`
