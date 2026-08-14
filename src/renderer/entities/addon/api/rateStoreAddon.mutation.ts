import gql from 'graphql-tag'

export default gql`
    mutation RateStoreAddon($id: String!, $rating: Int) {
        rateStoreAddon(id: $id, rating: $rating) {
            average
            count
            myRating
        }
    }
`
