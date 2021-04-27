import { NODE_TYPES } from 'common/enums'

export default /* GraphQL */ `
  union Response = Article | Comment

  extend type Article {
    "The counting number of this article."
    responseCount: Int!

    "List of responses of a article."
    responses(input: ResponsesInput!): ResponseConnection!
  }

  type ResponseConnection implements Connection {
    totalCount: Int!
    pageInfo: PageInfo!
    edges: [ResponseEdge!]
  }

  type ResponseEdge {
    cursor: String!
    node: Response! @logCache(type: "${NODE_TYPES.Response}")
  }

  input ResponsesInput {
    sort: ResponseSort
    after: String
    before: String
    includeAfter: Boolean
    includeBefore: Boolean
    first: Int
    articleOnly: Boolean
  }

  "Enums for sorting responses."
  enum ResponseSort {
    oldest
    newest
  }
`
