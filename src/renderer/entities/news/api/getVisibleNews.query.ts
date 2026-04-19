import { gql } from '@apollo/client'

const GET_VISIBLE_NEWS = gql`
    query GetVisibleNews {
        getVisibleNews {
            id
            slug
            title
            description
            content
            image
            date
            isVisible
            author
            readTime
        }
    }
`

export default GET_VISIBLE_NEWS
