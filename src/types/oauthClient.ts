import { CACHE_TTL } from 'common/enums'

export default /* GraphQL */ `
  extend type Query {
    oauthClient(input: OAuthClientInput!): OAuthClient @cacheControl(maxAge: ${CACHE_TTL.INSTANT})
  }

  extend type Mutation {
    "Create or Update an OAuth Client, used in OSS."
    putOAuthClient(input: PutOAuthClientInput!): OAuthClient @authorize
  }

  type OAuthClient {
    "Unique Client ID of this OAuth Client."
    id: ID!

    "App name"
    name: String!

    "App Description"
    description: String

    "URL for oauth client's official website"
    website: URL

    "Scopes"
    scope: [String!]

    "URL for oauth client's avatar."
    avatar: URL

    "Client secret"
    secret: String! @authorize

    "Redirect URIs"
    redirectURIs: [URL!] @authorize

    "Grant Types"
    grantTypes: [GrantType!] @authorize

    "Linked Developer Account"
    user: User

    "Creation Date"
    createdAt: Date!
  }

  type OAuthClientConnection implements Connection {
    totalCount: Int!
    pageInfo: PageInfo!
    edges: [OAuthClientEdge!]
  }

  type OAuthClientEdge {
    cursor: String!
    node: OAuthClient!
  }

  input OAuthClientInput {
    id: ID!
  }

  input PutOAuthClientInput {
    id: ID
    name: String
    description: String
    website: URL
    scope: [String!]
    avatar: ID
    secret: String
    redirectURIs: [URL!]
    grantTypes: [GrantType!]
    user: ID
  }

  enum GrantType {
    authorization_code
    refresh_token
  }
`