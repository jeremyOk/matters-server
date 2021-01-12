import { makeSummary } from '@matters/matters-html-formatter'
import _ from 'lodash'
import { v4 } from 'uuid'

import {
  ARTICLE_STATE,
  ASSET_TYPE,
  PUBLISH_STATE,
  USER_STATE,
} from 'common/enums'
import {
  ArticleNotFoundError,
  AssetNotFoundError,
  AuthenticationError,
  DraftNotFoundError,
  ForbiddenByStateError,
  ForbiddenError,
} from 'common/errors'
import { fromGlobalId, sanitize } from 'common/utils'
import { ItemData, MutationToPutDraftResolver } from 'definitions'

const resolver: MutationToPutDraftResolver = async (
  root,
  { input },
  { viewer, dataSources: { draftService, systemService, articleService } }
) => {
  const { id, title, content, tags, cover, collection } = input
  if (!viewer.id) {
    throw new AuthenticationError('visitor has no permission')
  }

  if (viewer.state === USER_STATE.frozen) {
    throw new ForbiddenByStateError(`${viewer.state} user has no permission`)
  }

  // check for asset existence
  let coverId
  if (cover) {
    const asset = await systemService.findAssetByUUID(cover)

    if (
      !asset ||
      [ASSET_TYPE.embed, ASSET_TYPE.cover].indexOf(asset.type) < 0 ||
      asset.authorId !== viewer.id
    ) {
      throw new AssetNotFoundError('Asset does not exists')
    }

    coverId = asset.id
  }

  // check for collection existence
  // add to dbId array if ok
  let collectionIds
  if (collection) {
    collectionIds = await Promise.all(
      collection.map(async (articleGlobalId) => {
        if (!articleGlobalId) {
          throw new ArticleNotFoundError(
            `Cannot find article ${articleGlobalId}`
          )
        }
        const { id: articleId } = fromGlobalId(articleGlobalId)
        const article = await articleService.baseFindById(articleId)
        if (!article) {
          throw new ArticleNotFoundError(
            `Cannot find article ${articleGlobalId}`
          )
        } else if (article.state !== ARTICLE_STATE.active) {
          throw new ForbiddenError(
            `Article ${article.title} cannot be collected.`
          )
        } else {
          return articleId
        }
      })
    )
  }

  // assemble data
  const data: ItemData = _.omitBy(
    {
      authorId: id ? undefined : viewer.id,
      title,
      summary: content && makeSummary(content),
      content: content && sanitize(content),
      tags,
      cover: coverId,
      collection: collectionIds,
    },
    _.isNil
  )

  // Update
  if (id) {
    const { id: dbId } = fromGlobalId(id)
    const draft = await draftService.dataloader.load(dbId)

    // check for draft existence
    if (!draft) {
      throw new DraftNotFoundError('target draft does not exist')
    }

    // check for permission
    if (draft.authorId !== viewer.id) {
      throw new ForbiddenError('viewer has no permission')
    }

    // check for draft state
    if (
      draft.publishState === PUBLISH_STATE.pending ||
      draft.publishState === PUBLISH_STATE.published
    ) {
      throw new ForbiddenError(
        'current publishState is not allow to be updated'
      )
    }

    // update
    return draftService.baseUpdate(dbId, {
      ...data,
      updatedAt: new Date(),
      cover: cover === null ? null : data.cover || draft.cover,
    })
  }

  // Create
  else {
    const draft = await draftService.baseCreate({ uuid: v4(), ...data })
    return draft
  }
}

export default resolver
