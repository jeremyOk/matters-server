import { USER_STATE } from 'common/enums'
import { AuthenticationError, ForbiddenError } from 'common/errors'
import { fromGlobalId, toGlobalId } from 'common/utils'
import { MutationToUnvoteCommentResolver } from 'definitions'

const resolver: MutationToUnvoteCommentResolver = async (
  _,
  { input: { id } },
  {
    viewer,
    dataSources: { articleService, commentService, notificationService },
  }
) => {
  if (!viewer.id) {
    throw new AuthenticationError('visitor has no permission')
  }

  const { id: dbId } = fromGlobalId(id)
  const comment = await commentService.dataloader.load(dbId)
  const article = await articleService.dataloader.load(comment.articleId)

  if (article.authorId !== viewer.id && viewer.state !== USER_STATE.active) {
    throw new ForbiddenError('viewer has no permission')
  }

  await commentService.unvote({ commentId: dbId, userId: viewer.id })

  // publish a PubSub event
  notificationService.pubsub.publish(
    toGlobalId({
      type: 'Article',
      id: article.id,
    }),
    article
  )

  return comment
}

export default resolver
