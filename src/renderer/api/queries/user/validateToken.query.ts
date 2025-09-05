import gql from 'graphql-tag'

export default gql`
    query ValidateToken($token: String!) {
        validateToken(token: $token)
    }
`
