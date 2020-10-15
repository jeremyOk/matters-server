import { AUTH_MODE, CACHE_TTL, NODE_TYPES, SCOPE_GROUP } from 'common/enums'

export default /* GraphQL */ `
  extend type Query {
    node(input: NodeInput!): Node @privateCache @logCache(type: "${NODE_TYPES.node}")
    nodes(input: NodesInput!): [Node!] @privateCache @logCache(type: "${NODE_TYPES.node}")
    frequentSearch(input: FrequentSearchInput!): [String!] @cacheControl(maxAge: ${CACHE_TTL.PUBLIC_SEARCH})
    search(input: SearchInput!): SearchResultConnection! @privateCache @cacheControl(maxAge: ${CACHE_TTL.PUBLIC_SEARCH})
    official: Official! @privateCache
    oss: OSS! @auth(mode: "${AUTH_MODE.admin}") @privateCache
  }

  extend type Mutation {
    "Upload a single file."
    singleFileUpload(input: SingleFileUploadInput!): Asset! @auth(mode: "${AUTH_MODE.oauth}", group: "${SCOPE_GROUP.level3}")

    "Add specific user behavior record."
    logRecord(input: LogRecordInput!): Boolean

    ##############
    #     OSS    #
    ##############
    setBoost(input: SetBoostInput!): Node! @auth(mode: "${AUTH_MODE.admin}")
    putRemark(input: PutRemarkInput!): String @auth(mode: "${AUTH_MODE.admin}")
    putSkippedListItem(input: PutSkippedListItemInput!): [SkippedListItem!] @auth(mode: "${AUTH_MODE.admin}")
    setFeature(input: SetFeatureInput!): Feature! @auth(mode: "${AUTH_MODE.admin}")
  }

  extend type Subscription {
    nodeEdited(input: NodeEditedInput!): Node!
  }

  interface Node {
    id: ID!
  }

  type PageInfo {
    startCursor: String
    endCursor: String
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  interface Connection {
    totalCount: Int!
    pageInfo: PageInfo!
  }

  "This type contains system-wise settings."
  type Official {
    "Feature flag"
    features: [Feature!]!
  }

  type Feature {
    name: FeatureName!
    enabled: Boolean!
  }

  type OSS @cacheControl(maxAge: ${CACHE_TTL.INSTANT}) {
    users(input: ConnectionArgs!): UserConnection!
    comments(input: ConnectionArgs!): CommentConnection!
    articles(input: ConnectionArgs!): ArticleConnection!
    tags(input: TagsInput!): TagConnection!
    oauthClients(input: ConnectionArgs!): OAuthClientConnection!
    skippedListItems(input: SkippedListItemsInput!): SkippedListItemsConnection!
  }


  """
  This type contains type, link and related data of an asset.
  """
  type Asset {
    "Unique ID of this Asset."
    id: ID!

    "Types of this asset."
    type: AssetType!

    "Link of this asset."
    path: String!

    "Time of this asset was created."
    createdAt: DateTime!
  }

  type SearchResultConnection implements Connection {
    totalCount: Int!
    pageInfo: PageInfo!
    edges: [SearchResultEdge!]
  }

  type SearchResultEdge {
    cursor: String!
    node: Node! @logCache(type: "${NODE_TYPES.node}")
  }

  input SkippedListItemsInput {
    after: String
    first: Int
    type: SkippedListItemType
  }

  type SkippedListItemsConnection implements Connection {
    totalCount: Int!
    pageInfo: PageInfo!
    edges: [SkippedListItemEdge!]
  }

  type SkippedListItemEdge {
    cursor: String!
    node: SkippedListItem
  }

  type SkippedListItem {
    id: ID!
    uuid: UUID!
    type: SkippedListItemType!
    value: String!
    archived: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input NodeInput {
    id: ID!
  }

  input NodesInput {
    ids: [ID!]!
  }

  input ReportsInput {
    article: Boolean!
    comment: Boolean!
    after: String
    first: Int
  }

  input FrequentSearchInput {
    key: String
    first: Int
  }

  input NodeEditedInput {
    id: ID!
  }

  input SearchInput {
    key: String!
    type: SearchTypes!
    after: String
    first: Int
    filter: SearchFilter
    "whether this search operation should be recorded in search history"
    record: Boolean
    oss: Boolean
  }

  input SearchFilter {
    authorId: ID
  }

  input SingleFileUploadInput {
    type: AssetType!
    file: Upload
    url: URL
    entityType: EntityType!
    entityId: ID
  }

  input SetBoostInput {
    id: ID!
    boost: NonNegativeFloat!
    type: BoostTypes!
  }

  input PutRemarkInput {
    id: ID!
    remark: String!
    type: RemarkTypes!
  }

  input PutSkippedListItemInput {
    id: ID
    type: SkippedListItemType
    value: String
    archived: Boolean
  }

  input LogRecordInput {
    type: LogRecordTypes!
  }

  input ConnectionArgs {
    after: String
    first: Int
    oss: Boolean
  }

  "Common input to toggle single item for \`toggleXXX\` mutations"
  input ToggleItemInput {
    id: ID!
    enabled: Boolean
  }

  input SetFeatureInput {
    name: FeatureName!
    flag: FeatureFlag!
  }

  enum SearchTypes {
    Article
    User
    Tag
  }

  enum BoostTypes {
    Article
    User
    Tag
  }

  enum RemarkTypes {
    Article
    User
    Tag
    Comment
    Report
    Feedback
  }

  enum LogRecordTypes {
    ReadFolloweeArticles
    ReadResponseInfoPopUp
  }

  "Enums for asset types."
  enum AssetType {
    avatar
    cover
    embed
    embedaudio
    profileCover
    oauthClientAvatar
    tagCover
  }

  enum EntityType {
    article
    draft
    tag
    user
  }

  "Enums for user roles."
  enum Role {
    vistor
    user
    admin
  }

  enum CacheScope {
    PUBLIC
    PRIVATE
  }

  enum SkippedListItemType {
    agent_hash
    email
    domain
  }

  enum FeatureName {
    add_credit
    payment
    payout
    verify_appreciate
    fingerprint
    tag_adoption
  }

  enum FeatureFlag {
    on
    off
    admin
  }

  input CostComplexity {
    min: Int = 1
    max: Int
  }

  directive @cacheControl(
    maxAge: Int
    scope: CacheScope
  ) on OBJECT | FIELD | FIELD_DEFINITION

  directive @cost(
    multipliers: [String]
    useMultipliers: Boolean
    complexity: CostComplexity
  ) on OBJECT | FIELD_DEFINITION

  "Rate limit within a given period of time, in seconds"
  directive @rateLimit(period: Int!, limit: Int!) on FIELD_DEFINITION

  directive @deprecated(
    reason: String = "No longer supported"
  ) on FIELD_DEFINITION | ENUM_VALUE

  directive @auth(mode: String!, group: String) on FIELD_DEFINITION

  directive @privateCache(strict: Boolean! = false) on FIELD_DEFINITION

  directive @objectCache(maxAge: Int = 1000) on OBJECT | FIELD_DEFINITION

  directive @logCache(type: String!, identifier: String = "id") on FIELD_DEFINITION

  directive @purgeCache(type: String!, identifier: String = "id") on FIELD_DEFINITION
`
