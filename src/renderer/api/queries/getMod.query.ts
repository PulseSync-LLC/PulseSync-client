import gql from 'graphql-tag'

export default gql`
    query GetMod {
        getMod {
            id
            musicVersion
            modVersion
            downloadUrl
            createdAt
            showModal
            checksum
            spoof
        }
    }
`
