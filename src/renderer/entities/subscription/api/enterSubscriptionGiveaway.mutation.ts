import gql from 'graphql-tag'

export default gql`
    mutation EnterSubscriptionGiveaway($id: String!) {
        enterSubscriptionGiveaway(id: $id) {
            uuid
        }
    }
`
