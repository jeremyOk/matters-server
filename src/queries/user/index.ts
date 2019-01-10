import { Context } from 'definitions'
import { toGlobalId } from 'common/utils'
import { MAT_UNIT } from 'common/enums'

import rootUser from './rootUser'
import subscriptions from './subscriptions'
import followers from './followers'
import followees from './followees'
import isFollower from './isFollower'
import isFollowee from './isFollowee'
import avatar from './avatar'
import userNameEditable from './userNameEditable'
import articleCount from './articleCount'
import commentCount from './commentCount'
// import oauthType from './oauthType'
import history from './history'
import notification from './notification'
import followerCount from './followerCount'
import followeeCount from './followeeCount'
import subscriptionCount from './subscriptionCount'
import unreadNoticeCount from './unreadNoticeCount'
import Recommendation from './recommendation'
import invitationLeft from './invitationLeft'
import invitationSent from './invitationSent'
import invitationRecipient from './invitationRecipient'
import invitationAccepted from './invitationAccepted'
import { MAT, Transaction } from './transaction'

export default {
  Query: {
    viewer: (root: any, _: any, { viewer }: Context) => viewer,
    user: rootUser
  },
  User: {
    id: ({ id }: { id: string }) => toGlobalId({ type: 'User', id }),
    info: (root: any) => root,
    settings: (root: any) => root,
    status: (root: any) => root,
    activity: (root: any) => root,
    recommendation: (root: any) => root,
    // hasFollowed,
    subscriptions,
    // quotations,
    followers,
    followees,
    isFollower,
    isFollowee
  },
  Recommendation,
  UserInfo: {
    avatar,
    userNameEditable
  },
  UserSettings: {
    // oauthType,
    notification
  },
  UserActivity: {
    history
  },
  MAT,
  Transaction,
  UserStatus: {
    MAT: (root: any) => root,
    invitation: (root: any) => root,
    articleCount,
    // viewCount,
    // draftCount,
    commentCount,
    // quotationCount
    followerCount,
    followeeCount,
    subscriptionCount,
    unreadNoticeCount
  },
  ReadHistory: {
    id: ({ uuid }: { uuid: string }) => uuid
  },
  InvitationStatus: {
    MAT: () => MAT_UNIT.joinByInvitation,
    left: invitationLeft,
    sent: invitationSent
  },
  Invitation: {
    id: ({ id }: { id: string }) => toGlobalId({ type: 'Invitation', id }),
    user: invitationRecipient,
    accepted: invitationAccepted
  }
}
