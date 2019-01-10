import DataLoader from 'dataloader'
import { hash, compare } from 'bcrypt'
import { v4 } from 'uuid'
import jwt from 'jsonwebtoken'
import bodybuilder from 'bodybuilder'
import _ from 'lodash'

import {
  BATCH_SIZE,
  BCRYPT_ROUNDS,
  USER_ACTION,
  TRANSACTION_PURPOSE,
  MAT_UNIT
} from 'common/enums'
import { environment } from 'common/environment'
import {
  ItemData,
  GQLSearchInput,
  GQLUpdateUserInfoInput,
  GQLListInput
} from 'definitions'
import { BaseService } from './baseService'
import { stringList } from 'aws-sdk/clients/datapipeline'

export class UserService extends BaseService {
  constructor() {
    super('user')
    this.dataloader = new DataLoader(this.baseFindByIds)
    this.uuidLoader = new DataLoader(this.baseFindByUUIDs)
  }

  // dump all data to es. Currently only used in test.
  initSearch = async () => {
    const users = await this.knex(this.table).select(
      'id',
      'description',
      'display_name',
      'user_name'
    )

    return this.es.indexItems({
      index: this.table,
      items: users
    })
  }

  /**
   * Create a new user.
   */
  create = async ({
    email,
    userName,
    displayName,
    description,
    password
  }: {
    [key: string]: string
  }) => {
    // TODO: do code validation here

    // TODO: better default unique user name
    if (!userName) {
      userName = email
    }

    // TODO:
    const avatar = null

    const uuid = v4()
    const passwordHash = await hash(password, BCRYPT_ROUNDS)
    const user = await this.baseCreate({
      uuid,
      email,
      userName,
      displayName,
      description,
      avatar,
      passwordHash,
      state: 'onboarding'
    })
    await this.baseCreate({ userId: user.id }, 'user_notify_setting')
    await this.activateInvitedEmailUser({
      userId: user.id,
      email
    })

    await this.addToSearch(user)

    return user
  }

  /**
   * Upadte user info
   */
  update = async (
    id: string,
    input: GQLUpdateUserInfoInput & { email: string }
  ) => {
    const user = await this.baseUpdateById(id, input)

    const { description, displayName, userName, email } = input
    if (description || displayName || userName || email) {
      // remove null and undefined
      const searchable = _.pickBy(
        { description, displayName, userName, email },
        _.identity
      )

      const esRes = await this.es.client.update({
        index: this.table,
        type: this.table,
        id,
        body: {
          doc: searchable
        }
      })
    }

    return user
  }

  /**
   * Check is username editable
   */
  isUserNameEditable = async (userId: string) => {
    const history = await this.knex('username_edit_history')
      .select()
      .where({ userId })
    return history.length <= 0
  }

  /**
   * Add user name edit history
   */
  addUserNameEditHistory = async ({
    userId,
    previous
  }: {
    userId: string
    previous: string
  }) => await this.baseCreate({ userId, previous }, 'username_edit_history')

  addToSearch = async ({
    id,
    userName,
    displayName,
    description
  }: {
    [key: string]: string
  }) => {
    const result = await this.es.indexItems({
      index: this.table,
      items: [
        {
          id,
          userName,
          displayName,
          description
        }
      ]
    })

    return result
  }

  search = async ({ key, limit = 10, offset = 0 }: GQLSearchInput) => {
    const body = bodybuilder()
      .query('multi_match', {
        query: key,
        fuzziness: 5,
        fields: ['description', 'displayName', 'userName']
      })
      .size(limit)
      .from(offset)
      .build()

    try {
      const { hits } = await this.es.client.search({
        index: this.table,
        type: this.table,
        body
      })
      const ids = hits.hits.map(({ _id }) => _id)
      // TODO: determine if id exsists and use dataloader
      const users = await this.baseFindByIds(ids)
      return users.map((user: { [key: string]: string }) => ({
        node: { ...user, __type: 'User' },
        match: key
      }))
    } catch (err) {
      throw err
    }
  }

  /**
   * Login user and return jwt token.
   */
  login = async ({ email, password }: { email: string; password: string }) => {
    const user = await this.findByEmail(email)

    if (!user) {
      console.log('Cannot find user with email, login failed.')
      return {
        auth: false
      }
    }

    const auth = await compare(password, user.passwordHash)
    if (!auth) {
      console.log('Password incorrect, login failed.')
      return {
        auth: false
      }
    }

    const token = jwt.sign({ uuid: user.uuid }, environment.jwtSecret, {
      expiresIn: 86400 * 90 // expires in 24 * 90 hours
    })

    console.log(`User logged in with uuid ${user.uuid}.`)
    return {
      auth: true,
      token
    }
  }

  /**
   * Get user's total MAT
   */
  totalMAT = async (userId: string) => {
    const result = await this.knex('transaction_delta_view')
      .where({
        userId
      })
      .sum('delta as total')

    return parseInt(result[0].total || 0, 10)
  }

  /**
   * Get user's transaction history
   */
  transactionHistory = async ({
    limit = BATCH_SIZE,
    offset = 0,
    id
  }: GQLListInput & { id: string }) => {
    const result = await this.knex('transaction_delta_view')
      .where({
        userId: id
      })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)
    return result
  }

  /**
   * Count user's following list by a given user id.
   */
  countFollowees = async (userId: string): Promise<number> => {
    const result = await this.knex('action_user')
      .countDistinct('id')
      .where({
        userId,
        action: USER_ACTION.follow
      })
      .first()
    return parseInt(result.count, 10)
  }

  /**
   * Count user's followed list by a given taget id (user).
   */
  countFollowers = async (targetId: string): Promise<number> => {
    const result = await this.knex('action_user')
      .countDistinct('id')
      .where({ targetId, action: USER_ACTION.follow })
      .first()
    return parseInt(result.count, 10)
  }

  recommendAuthor = async ({ offset = 0, limit = 5 }) =>
    this.knex('user_reader_view')
      .select()
      .orderBy('author_score', 'desc')
      .offset(offset)
      .limit(limit)

  followeeArticles = async ({
    id,
    offset = 0,
    limit = 5
  }: GQLListInput & { id: string }) =>
    this.knex('action_user as au')
      .select('ar.*')
      .join('article as ar', 'ar.author_id', 'au.target_id')
      .where({ action: 'follow', userId: id })
      .offset(offset)
      .limit(limit)

  /**
   * Count an users' subscription by a given user id.
   */
  countSubscription = async (userId: string): Promise<number> => {
    const result = await this.knex('action_article')
      .countDistinct('id')
      .where({ userId, action: USER_ACTION.subscribe })
      .first()
    return parseInt(result.count, 10)
  }

  /**
   * Count an users' unread notice by a given user id.
   */
  countUnreadNotice = async (userId: string): Promise<number> => {
    const result = await this.knex('notice')
      .countDistinct('id')
      .where({ recipientId: userId, unread: true, deleted: false })
      .first()
    return parseInt(result.count, 10)
  }

  /**
   * Find users by a given email.
   */
  findByEmail = async (
    email: string
  ): Promise<{ uuid: string; [key: string]: string }> =>
    this.knex
      .select()
      .from(this.table)
      .where({ email })
      .first()

  /**
   * Find users by a given user name.
   */
  findByUserName = async (userName: string): Promise<any[]> =>
    await this.knex
      .select()
      .from(this.table)
      .where({ userName })
      .first()

  /**
   * Find user's notify setting by a given user id.
   */
  findNotifySetting = async (userId: string): Promise<any | null> =>
    await this.knex
      .select()
      .from('user_notify_setting')
      .where({ userId })
      .first()

  /**
   * Find user's OAuth accounts by a given user id.
   */
  findOAuth = async (userId: string): Promise<any> =>
    await this.knex
      .select()
      .from('user_oauth')
      .where('user_id', userId)
      .first()

  /**
   * Find user's OAuth accounts by a given user id and type.
   */
  findOAuthByType = async (userId: string, type: string): Promise<any> =>
    await this.knex
      .select()
      .from('user_oauth')
      .where({ userId, type })
      .first()

  /**
   * Find user's all OAuth types by a given user id.
   */
  // findOAuthTypes = async (userId: string): Promise<any[]> =>
  //   await this.knex
  //     .select('type')
  //     .from('user_oauth')
  //     .where({ userId })

  /**
   * Find user's all transactions by a given user id.
   */
  findTransactionsByUserId = async (userId: string): Promise<any[]> =>
    await this.knex
      .select()
      .from('transaction')
      .where({ recipientId: userId })
      .orderBy('id', 'desc')

  /**
   * Find user's followee list by a given user id.
   */
  findFollowees = async ({
    userId,
    offset = 0,
    limit = BATCH_SIZE
  }: {
    userId: string
    offset?: number
    limit?: number
  }) =>
    this.knex
      .select()
      .from('action_user')
      .where({ userId, action: USER_ACTION.follow })
      .orderBy('id', 'desc')
      .offset(offset)
      .limit(limit)

  /**
   * Find user's follower list by a given taget id (user).
   */
  findFollowers = async (targetId: string): Promise<any[]> =>
    await this.knex
      .select()
      .from('action_user')
      .where({ targetId, action: USER_ACTION.follow })

  /**
   * Find user's follower list by a given taget id (user) in batches.
   */
  findFollowersInBatch = async (
    targetId: string,
    offset: number,
    limit = BATCH_SIZE
  ): Promise<any[]> =>
    await this.knex
      .select()
      .from('action_user')
      .where({ targetId, action: USER_ACTION.follow })
      .orderBy('id', 'desc')
      .offset(offset)
      .limit(limit)

  /**
   * Is user following target
   */
  isFollowing = async ({
    userId,
    targetId
  }: {
    userId: string
    targetId: string
  }): Promise<boolean> => {
    const result = await this.knex
      .select()
      .from('action_user')
      .where({ userId, targetId, action: USER_ACTION.follow })
    return result.length > 0
  }

  /**
   * Find an users' subscription by a given user id.
   */
  findSubscriptions = async (userId: string): Promise<any[]> =>
    await this.knex
      .select()
      .from('action_article')
      .where({ userId, action: USER_ACTION.subscribe })

  /**
   * Find an users' subscription by a given user id in batches.
   */
  findSubscriptionsInBatch = async (
    userId: string,
    offset: number,
    limit = BATCH_SIZE
  ): Promise<any[]> => {
    return await this.knex
      .select()
      .from('action_article')
      .where({ userId, action: USER_ACTION.subscribe })
      .orderBy('id', 'desc')
      .offset(offset)
      .limit(limit)
  }

  /**
   * Find user's read history
   */
  findReadHistory = async (
    userId: string,
    offset: number,
    limit = BATCH_SIZE
  ): Promise<any[]> =>
    await this.knex
      .select()
      .from('article_read')
      .where({ userId, archived: false })
      .orderBy('id', 'desc')
      .offset(offset)
      .limit(limit)

  /**
   * Find user's read history by a given uuid (article_read)
   */
  findReadHistoryByUUID = async (
    uuid: string,
    userId: string
  ): Promise<any[]> =>
    await this.knex
      .select()
      .from('article_read')
      .where({
        uuid,
        userId,
        archived: false
      })
      .first()

  /**
   * Update user_notify_setting by a given user id
   */
  updateNotifySetting = async (
    id: string,
    data: ItemData
  ): Promise<any | null> =>
    await this.baseUpdateById(id, data, 'user_notify_setting')

  /**
   * Follow a user by a given taget id (user).
   */
  follow = async (userId: string, targetId: string): Promise<any[]> =>
    await this.baseUpdateOrCreate(
      {
        userId,
        targetId,
        action: USER_ACTION.follow
      },
      ['userId', 'targetId', 'action'],
      'action_user'
    )

  /**
   * Unfollow a user by a given taget id (user).
   */
  unfollow = async (userId: string, targetId: string): Promise<any[]> =>
    await this.knex
      .from('action_user')
      .where({
        targetId,
        userId,
        action: USER_ACTION.follow
      })
      .del()

  /**
   * Find invitation by email
   */
  findInvitationByEmail = async (email: string) =>
    await this.knex
      .select()
      .from('invitation')
      .where({ email })
      .first()

  /**
   * Find invitations
   */
  findInvitations = async ({
    userId,
    offset = 0,
    limit = BATCH_SIZE
  }: {
    userId: string
    offset?: number
    limit?: number
  }): Promise<any[]> =>
    await this.knex
      .select()
      .from('invitation')
      .where({ senderId: userId })
      .orderBy('id', 'desc')
      .offset(offset)
      .limit(limit)

  /**
   * count invitations
   */
  countInvitation = async (userId: string) => {
    const result = await this.knex('invitation')
      .select()
      .count('id')
      .where({ senderId: userId })
      .first()
    return parseInt(result.count, 10)
  }

  /**
   * Find invitation by id
   */
  findInvitation = async (id: string) => {
    const result = await this.knex('invitation')
      .select()
      .where({ id })
      .first()
    return result
  }
  /**
   * Activate user
   */
  activate = async ({
    senderId,
    recipientId
  }: {
    senderId?: string
    recipientId: string
  }): Promise<any> => {
    await this.knex.transaction(async trx => {
      // set recipient's state to "active"
      await trx
        .where({ id: recipientId })
        .update({ state: 'active' })
        .into(this.table)
        .returning('*')
      // add invitation record
      const { id: invitationId } = await trx
        .insert({ senderId, recipientId, status: 'activated' })
        .into('invitation')
        .returning('*')
      // add transaction record
      await trx
        .insert({
          uuid: v4(),
          recipientId,
          referenceId: invitationId,
          purpose: TRANSACTION_PURPOSE.joinByInvitation,
          amount: MAT_UNIT.joinByInvitation
        })
        .into('transaction')
        .returning('*')
      await trx
        .insert({
          uuid: v4(),
          recipientId: senderId,
          referenceId: invitationId,
          purpose: TRANSACTION_PURPOSE.invitationAccepted,
          amount: MAT_UNIT.invitationAccepted
        })
        .into('transaction')
        .returning('*')
    })
  }

  /**
   * Invite email
   */
  invite = async ({
    senderId,
    email
  }: {
    senderId?: string
    email: string
  }): Promise<any> =>
    await this.baseCreate({ senderId, email, status: 'pending' }, 'invitation')

  /**
   * Activate new user of invited email
   */
  activateInvitedEmailUser = async ({
    userId,
    email
  }: {
    userId: string
    email: string
  }) => {
    try {
      const invitation = await this.findInvitationByEmail(email)

      if (!invitation) {
        return
      }

      const sender =
        invitation.senderId && (await this.dataloader.load(invitation.senderId))
      await this.knex.transaction(async trx => {
        // set recipient's state to "active"
        await trx
          .where({ id: userId })
          .update({ state: 'active' })
          .into(this.table)
          .returning('*')
        // add transaction record
        await trx
          .insert({
            uuid: v4(),
            recipientId: userId,
            referenceId: invitation.id,
            purpose: TRANSACTION_PURPOSE.joinByInvitation,
            amount: MAT_UNIT.joinByInvitation
          })
          .into('transaction')
          .returning('*')
        if (sender) {
          await trx
            .insert({
              uuid: v4(),
              recipientId: sender.id,
              referenceId: invitation.id,
              purpose: TRANSACTION_PURPOSE.invitationAccepted,
              amount: MAT_UNIT.invitationAccepted
            })
            .into('transaction')
            .returning('*')
        }
      })
    } catch (e) {
      console.error('[activateInvitedEmailUser]', e)
    }
  }
}
