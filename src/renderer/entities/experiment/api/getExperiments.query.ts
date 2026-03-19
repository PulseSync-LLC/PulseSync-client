import { gql } from '@apollo/client'

const GET_EXPERIMENTS = gql`
    query GetExperiments {
        getExperiments {
            key
            group
            description
            enabled
            value
            rollout
        }
    }
`

export default GET_EXPERIMENTS
