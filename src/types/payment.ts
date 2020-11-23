import { AUTH_MODE, CACHE_TTL, NODE_TYPES, SCOPE_GROUP } from 'common/enums'

export default /* GraphQL */ `
  extend type Mutation {
    "Add Credit to User Wallet"
    addCredit(input: AddCreditInput!): AddCreditResult! @auth(mode: "${AUTH_MODE.oauth}", group: "${SCOPE_GROUP.level3}")

    "Pay to another user or article"
    payTo(input: PayToInput!): PayToResult! @auth(mode: "${AUTH_MODE.oauth}", group: "${SCOPE_GROUP.level3}")

    "Payout to user"
    payout(input: PayoutInput!): Transaction! @auth(mode: "${AUTH_MODE.oauth}", group: "${SCOPE_GROUP.level3}")

    "Create Stripe Connect account for Payout"
    connectStripeAccount: ConnectStripeAccountResult! @auth(mode: "${AUTH_MODE.oauth}", group: "${SCOPE_GROUP.level3}")


    ##############
    #     OSS    #
    ##############
    "Reward LIKE to users from Matters' Pool"
    reward(input: RewardToInput!): [RewardResult!] @auth(mode: "${AUTH_MODE.admin}")
  }

  extend type User {
    "User Wallet"
    wallet: Wallet! @auth(mode: "${AUTH_MODE.oauth}")
  }

  extend type UserStatus {
    "Number of articles donated by user"
    donatedArticleCount: Int!

    "Number of times of donations received by user"
    receivedDonationCount: Int!
  }

  union TransactionTarget = Article | Transaction

  type Wallet {
    balance: Balance! @cacheControl(maxAge: ${CACHE_TTL.INSTANT})
    transactions(input: TransactionsArgs!): TransactionConnection!
    stripeAccount: StripeAccount
  }

  type Balance {
    HKD: Float!
  }

  type Transaction @cacheControl(maxAge: ${CACHE_TTL.INSTANT}) {
    id: ID!

    state: TransactionState!

    purpose: TransactionPurpose!

    amount: Float!
    fee: NonNegativeFloat!

    currency: TransactionCurrency!

    "Timestamp of transaction."
    createdAt: DateTime!

    "Recipient of transaction."
    recipient: User

    "Sender of transaction."
    sender: User

    "Related target article or transaction."
    target: TransactionTarget @logCache(type: "${NODE_TYPES.transactionTarget}")

    "Message for end user, including reason of failure."
    message: String
  }

  type TransactionConnection implements Connection {
    totalCount: Int!
    pageInfo: PageInfo!
    edges: [TransactionEdge!]
  }

  type TransactionEdge {
    cursor: String!
    node: Transaction! @logCache(type: "${NODE_TYPES.transaction}")
  }

  input TransactionsArgs {
    after: String
    first: Int
    id: ID
    states: [TransactionState!]
  }

  enum TransactionState {
    pending
    succeeded
    failed
    canceled
  }

  enum TransactionPurpose {
    donation
    addCredit
    refund
    payout
  }

  enum TransactionCurrency {
    HKD
    LIKE
  }

  type AddCreditResult {
    transaction: Transaction!

    "The client secret of this PaymentIntent."
    client_secret: String!
  }

  type PayToResult {
    transaction: Transaction!

    "Only available when paying with LIKE."
    redirectUrl: URL
  }

  # Add Credit
  input AddCreditInput {
    amount: PositiveFloat!
  }

  input PayToInput {
    amount: PositiveFloat!
    currency: TransactionCurrency!
    purpose: TransactionPurpose!
    recipientId: ID!
    targetId: ID
    password: String
  }

  input PayoutInput {
    amount: PositiveFloat!
    password: String!
  }

  # Stripe Account
  type StripeAccount {
    id: ID!
    loginUrl: URL! @cacheControl(maxAge: ${CACHE_TTL.INSTANT})
  }

  type ConnectStripeAccountResult {
    redirectUrl: URL!
  }

  # Reward
  input RewardToInput {
    type: RewardType!
    recipientEmails: [Email!]
  }

  type RewardResult {
    recipient: User!
    state: RewardState
  }

  enum RewardState {
    skipped
    succeeded
    failed
  }

  enum RewardType {
    firstArticle
  }
`
