import { gql } from '@apollo/client'

export default gql`
    query GetModUpdates($modVersion: String!) {
        getChangelogEntries(modVersion: $modVersion) {
            id
            version
            description
            createdAt
        }
    }
`
