import _ from 'lodash'

import { MATERIALIZED_VIEW, VERIFICATION_CODE_STATUS } from 'common/enums'
import { fromGlobalId, toGlobalId } from 'common/utils'
import { refreshView, UserService } from 'connectors'
import { MaterializedView } from 'definitions'

import {
  defaultTestUser,
  getUserContext,
  registerUser,
  testClient
} from './utils'

let userService: any
beforeAll(async () => {
  userService = new UserService()
  // await userService.initSearch()
})

const USER_LOGIN = `
  mutation UserLogin($input: UserLoginInput!) {
    userLogin(input: $input) {
      auth
      token
    }
  }
`

const FOLLOW_USER = `
  mutation FollowerUser($input: FollowUserInput!) {
    followUser(input: $input) {
      isFollowee
    }
  }
`
const UNFOLLOW_USER = `
  mutation FollowerUser($input: UnfollowUserInput!) {
    unfollowUser(input: $input) {
      isFollowee
    }
  }
`
const UPDATE_USER_INFO_DESCRIPTION = `
  mutation UpdateUserInfo($input: UpdateUserInfoInput!) {
    updateUserInfo(input: $input) {
      info {
        description
      }
    }
  }
`
const UPDATE_USER_INFO_AVATAR = `
  mutation UpdateUserInfo($input: UpdateUserInfoInput!) {
    updateUserInfo(input: $input) {
      id
      avatar
    }
  }
`
const UPDATE_NOTIFICARION_SETTINGS = `
  mutation UpdateNotificationSetting($input: UpdateNotificationSettingInput!) {
    updateNotificationSetting(input: $input) {
      settings {
        notification {
          enable
        }
      }
    }
  }
`
const GET_USER_BY_USERNAME = `
  query ($input: UserInput!) {
    user(input: $input) {
      id
      userName
    }
  }
`

const GET_VIEWER_INFO = `
  query {
    viewer {
      uuid
      avatar
      displayName
      info {
        email
        description
        createdAt
        agreeOn
      }
    }
  }
`
const GET_VIEW_ARTICLES = `
  query ($input: ConnectionArgs!) {
    viewer {
      articles(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`
const GET_VIEWER_SETTINGS = `
  query {
    viewer {
      settings {
        language
        notification {
          enable
        }
      }
    }
  }
`

const GET_VIEWER_SUBSCRIPTIONS = `
  query ($input: ConnectionArgs!) {
    viewer {
      subscriptions(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`
const GET_VIEWER_FOLLOWERS = `
  query ($input: ConnectionArgs!) {
    viewer {
      followers(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`
const GET_VIEWER_FOLLOWEES = `
  query ($input: ConnectionArgs!) {
    viewer {
      followees(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`
const GET_VIEWER_STATUS = `
  query {
    viewer {
      status {
        articleCount
        commentCount
      }
    }
  }
`
const GET_VIEWER_RECOMMENDATION = (list: string) => `
query($input: ConnectionArgs!) {
  viewer {
    recommendation {
      ${list}(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
}
`

const GET_AUTHOR_RECOMMENDATION = (list: string) => `
query($input: AuthorsInput!) {
  viewer {
    recommendation {
      ${list}(input: $input) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
}
`

const GET_VIEWER_BADGES = `
  query {
    viewer {
      info {
        badges {
          type
        }
      }
    }
  }
`
const INVITE = `
  mutation Invite($input: InviteInput!) {
    invite(input: $input)
  }
`
const SEND_VERIFICATION_CODE = `
  mutation SendVerificationCode($input: SendVerificationCodeInput!) {
    sendVerificationCode(input: $input)
  }
`
const CONFIRM_VERIFICATION_CODE = `
  mutation ConfirmVerificationCode($input: ConfirmVerificationCodeInput!) {
    confirmVerificationCode(input: $input)
  }
`

describe('register and login functionarlities', () => {
  test('register user and retrieve info', async () => {
    const email = `test-${Math.floor(Math.random() * 100)}@matters.news`
    const code = await userService.createVerificationCode({
      type: 'register',
      email
    })
    await userService.markVerificationCodeAs({
      codeId: code.id,
      status: 'verified'
    })
    const user = {
      email,
      displayName: 'testUser',
      password: 'Abcd1234',
      codeId: code.uuid
    }
    const registerResult = await registerUser(user)
    expect(_.get(registerResult, 'data.userRegister.token')).toBeTruthy()

    const context = await getUserContext({ email: user.email })
    const { query } = await testClient({
      context
    })
    const newUserResult = await query({
      query: GET_VIEWER_INFO
    })
    const displayName = _.get(newUserResult, 'data.viewer.displayName')
    const info = _.get(newUserResult, 'data.viewer.info')
    expect(displayName).toBe(user.displayName)
    expect(info.email).toBe(user.email)
  })

  test('auth fail when password is incorrect', async () => {
    const email = 'test1@matters.news'
    const password = 'wrongPassword'
    const { mutate } = await testClient()

    const result = await mutate({
      mutation: USER_LOGIN,
      // @ts-ignore
      variables: { input: { email, password } }
    })
    expect(_.get(result, 'errors.0.extensions.code')).toBe(
      'USER_PASSWORD_INVALID'
    )
  })

  test('auth success when password is correct', async () => {
    const email = 'test1@matters.news'
    const password = '12345678'

    const { mutate } = await testClient()
    const result = await mutate({
      mutation: USER_LOGIN,
      // @ts-ignore
      variables: { input: { email, password } }
    })
    expect(_.get(result, 'data.userLogin.auth')).toBe(true)
  })

  test('retrive user info after login', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_INFO
    })
    const info = _.get(data, 'viewer.info')
    expect(info.email).toEqual(defaultTestUser.email)
  })
})

describe('user query fields', () => {
  test('get user by username', async () => {
    const userName = 'test1'
    const { query } = await testClient()
    const { data } = await query({
      query: GET_USER_BY_USERNAME,
      // @ts-ignore
      variables: { input: { userName } }
    })
    expect(_.get(data, 'user.userName')).toBe(userName)
  })
  test('retrive user articles', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const result = await query({
      query: GET_VIEW_ARTICLES,
      // @ts-ignore
      variables: { input: { first: 1 } }
    })
    const { data } = result
    const articles = _.get(data, 'viewer.articles.edges')
    expect(articles.length).toBeDefined()
    expect(articles[0].node.id).toBeDefined()
  })

  test('retrive UserSettings', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const res = await query({
      query: GET_VIEWER_SETTINGS
    })
    const { data } = res
    const settings = _.get(data, 'viewer.settings')
    expect(settings).toBeDefined()
    expect(settings.notification).toBeDefined()
  })

  test('retrive subscriptions', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_SUBSCRIPTIONS,
      // @ts-ignore
      variables: { input: {} }
    })
    const subscriptions = _.get(data, 'viewer.subscriptions.edges')
    expect(subscriptions.length).toBeTruthy()
  })

  test('retrive followers', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_FOLLOWERS,
      // @ts-ignore
      variables: { input: {} }
    })
    const followers = _.get(data, 'viewer.followers.edges')
    expect(followers).toBeDefined()
  })

  test('retrive followees', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_FOLLOWEES,
      // @ts-ignore
      variables: { input: {} }
    })
    const followees = _.get(data, 'viewer.followees.edges')
    expect(followees.length).toBeTruthy()
  })

  test('retrive UserStatus', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_STATUS
    })
    const status = _.get(data, 'viewer.status')
    expect(status).toBeDefined()
  })
})

describe('mutations on User object', () => {
  test('followUser and unfollowUser', async () => {
    const followeeId = toGlobalId({ type: 'User', id: '3' })

    // follow
    const { mutate } = await testClient({
      isAuth: true
    })
    const { data: followData } = await mutate({
      mutation: FOLLOW_USER,
      // @ts-ignore
      variables: { input: { id: followeeId } }
    })
    expect(
      followData && followData.followUser && followData.followUser.isFollowee
    ).toBeTruthy()

    // check
    const { query } = await testClient({ isAuth: true })
    const { data: followeeData } = await query({
      query: GET_VIEWER_FOLLOWEES,
      // @ts-ignore
      variables: { input: {} }
    })
    const followees = _.get(followeeData, 'viewer.followees.edges')
    expect(
      followees.map(({ node: { id } }: { node: { id: string } }) => id)
    ).toContain(followeeId)

    // unfollow
    const { mutate: mutateNew } = await testClient({ isAuth: true })
    const { data: unfollowData } = await mutateNew({
      mutation: UNFOLLOW_USER,
      // @ts-ignore
      variables: { input: { id: followeeId } }
    })
    expect(unfollowData && unfollowData.unfollowUser.isFollowee).toBeFalsy()

    // re-check
    const { query: queryNew } = await testClient({ isAuth: true })
    const { data: followeeDataNew } = await queryNew({
      query: GET_VIEWER_FOLLOWEES,
      // @ts-ignore
      variables: { input: {} }
    })
    const followeesNew = _.get(followeeDataNew, 'viewer.followees.edges')
    expect(
      followeesNew.filter(({ id }: { id: string }) => id === followeeId).length
    ).toEqual(0)
  })

  test('updateUserInfoDescription', async () => {
    const description = 'foo bar'
    const { mutate } = await testClient({
      isAuth: true
    })
    const { data } = await mutate({
      mutation: UPDATE_USER_INFO_DESCRIPTION,
      // @ts-ignore
      variables: { input: { description } }
    })
    const info = _.get(data, 'updateUserInfo.info')
    expect(info.description).toEqual(description)
  })

  test('updateUserInfoAvatar', async () => {
    const avatarAssetUUID = '00000000-0000-0000-0000-000000000001'
    const { mutate } = await testClient({
      isAuth: true
    })
    const { data } = await mutate({
      mutation: UPDATE_USER_INFO_AVATAR,
      // @ts-ignore
      variables: { input: { avatar: avatarAssetUUID } }
    })
    const avatar = _.get(data, 'updateUserInfo.avatar')
    expect(avatar).toEqual(expect.stringContaining('path/to/file.jpg'))
  })

  test('updateNotificationSetting', async () => {
    const { mutate } = await testClient({
      isAuth: true
    })
    const { data } = await mutate({
      mutation: UPDATE_NOTIFICARION_SETTINGS,
      // @ts-ignore
      variables: { input: { type: 'enable', enabled: false } }
    })
    const enable = _.get(
      data,
      'updateNotificationSetting.settings.notification.enable'
    )
    expect(enable).toBe(false)
  })
})

describe('user recommendations', () => {
  test('retrive articles from hottest, icymi, topics, followeeArticles and newest', async () => {
    await Promise.all(
      _.values(MATERIALIZED_VIEW).map(view =>
        refreshView(view as MaterializedView)
      )
    )

    const lists = ['hottest', 'icymi', 'topics', 'followeeArticles', 'newest']
    for (const list of lists) {
      const { query: queryNew } = await testClient({
        isAuth: true
      })
      const result = await queryNew({
        query: GET_VIEWER_RECOMMENDATION(list),
        // @ts-ignore
        variables: { input: { first: 1 } }
      })
      const { data } = result
      const article = _.get(data, `viewer.recommendation.${list}.edges.0.node`)
      expect(fromGlobalId(article.id).type).toBe('Article')
    }
  })

  test('retrive tags from tags', async () => {
    const { query: queryNew } = await testClient({
      isAuth: true
    })
    const { data } = await queryNew({
      query: GET_VIEWER_RECOMMENDATION('tags'),
      // @ts-ignore
      variables: { input: { first: 1 } }
    })
    const tag = _.get(data, 'viewer.recommendation.tags.edges.0.node')
    expect(fromGlobalId(tag.id).type).toBe('Tag')
  })

  test('retrive users from authors', async () => {
    const { query: queryNew } = await testClient({
      isAuth: true
    })
    const result = await queryNew({
      query: GET_AUTHOR_RECOMMENDATION('authors'),
      // @ts-ignore
      variables: { input: { first: 1 } }
    })
    const { data } = result
    const author = _.get(data, 'viewer.recommendation.authors.edges.0.node')
    expect(fromGlobalId(author.id).type).toBe('User')
  })
})

describe('badges', () => {
  test('get user badges', async () => {
    const { query } = await testClient({
      isAuth: true
    })
    const { data } = await query({
      query: GET_VIEWER_BADGES,
      // @ts-ignore
      variables: {}
    })
    expect(_.get(data, 'viewer.info.badges.0.type')).toBe('seed')
  })
})

describe('verification code', () => {
  const email = `verification-${Math.floor(Math.random() * 100)}@test.com`
  const type = 'register'

  test('send verification code', async () => {
    // send
    const { mutate } = await testClient()
    const result = await mutate({
      mutation: SEND_VERIFICATION_CODE,
      // @ts-ignore
      variables: { input: { type, email } }
    })
    expect(result && result.data && result.data.sendVerificationCode).toBe(true)

    const [code] = await userService.findVerificationCodes({ email })
    expect(code.status).toBe(VERIFICATION_CODE_STATUS.active)

    // confirm
    const { mutate: confirmMutate } = await testClient()
    const confirmedResult = await confirmMutate({
      mutation: CONFIRM_VERIFICATION_CODE,
      // @ts-ignore
      variables: { input: { type, email, code: code.code } }
    })
    expect(
      confirmedResult &&
        confirmedResult.data &&
        confirmedResult.data.confirmVerificationCode
    ).toBe(code.uuid)
    const [confirmedCode] = await userService.findVerificationCodes({ email })
    expect(confirmedCode.status).toBe(VERIFICATION_CODE_STATUS.verified)
  })
})
