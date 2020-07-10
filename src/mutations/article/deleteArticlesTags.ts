import _difference from 'lodash/difference'
import _some from 'lodash/some'
import _uniq from 'lodash/uniq'

import {
  AuthenticationError,
  ForbiddenError,
  TagNotFoundError,
  UserInputError,
} from 'common/errors'
import { fromGlobalId } from 'common/utils'
import { MutationToDeleteArticlesTagsResolver } from 'definitions'

const resolver: MutationToDeleteArticlesTagsResolver = async (
  root,
  { input: { id, articles } },
  {
    viewer,
    dataSources: {
      articleService,
      notificationService,
      tagService,
      userService,
    },
  }
) => {
  if (!viewer.id) {
    throw new AuthenticationError('viewer has no permission')
  }

  if (!articles) {
    throw new UserInputError('"articles" is required in update')
  }

  const { id: dbId } = fromGlobalId(id)
  const tag = await tagService.baseFindById(dbId)
  if (!tag) {
    throw new TagNotFoundError('tag not found')
  }

  const admin = 'hi@matters.news'
  const normalEditors = (await userService.baseFindByIds(tag.editors)).filter(
    (user) => user.email !== admin
  )

  // update only allow: editor, creator, matty
  const isEditor = _some(tag.editors, (editor) => editor === viewer.id)
  const isCreator = tag.creator === viewer.id
  const isMatty = viewer.email === admin
  const isMaintainer =
    isEditor || (normalEditors.length === 0 && isCreator) || isMatty

  if (!isMaintainer) {
    throw new ForbiddenError('only editor, creator and matty can manage tag')
  }

  // compare new and old article ids which have this tag
  const deleteIds = articles.map((articleId) => fromGlobalId(articleId).id)

  // delete unwanted
  await tagService.deleteArticleTagsByArticleIds({
    articleIds: deleteIds,
    tagId: dbId,
  })

  // trigger notification for deleting article tag
  deleteIds.forEach(async (articleId: string) => {
    const article = await articleService.baseFindById(articleId)
    notificationService.trigger({
      event: 'article_tag_has_been_removed',
      recipientId: article.authorId,
      actorId: viewer.id,
      entities: [
        {
          type: 'target',
          entityTable: 'article',
          entity: article,
        },
        {
          type: 'tag',
          entityTable: 'tag',
          entity: tag,
        },
      ],
    })
  })

  // add creator if not listed in editors
  if (!isEditor && !isMatty && isCreator) {
    const updatedTag = await tagService.baseUpdate(tag.id, {
      editors: _uniq([...tag.editors, viewer.id]),
    })
    return updatedTag
  }
  return tag
}

export default resolver
