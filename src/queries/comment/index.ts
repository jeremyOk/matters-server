import { BatchParams, Context } from 'definitions'
import { toGlobalId } from 'common/utils'

export default {
  User: {
    commentedArticles: async (
      { id }: { id: string },
      { input: { offset, limit } }: BatchParams,
      { commentService, articleService }: Context
    ) => {
      const articleIds = await commentService.findByAuthorInBatch(
        id,
        offset,
        limit
      )
      return articleService.baseFindByIds(articleIds)
    }
  },
  Article: {
    commentCount: (
      { id }: { id: string },
      _: any,
      { commentService }: Context
    ) => commentService.countByArticle(id),
    pinnedComments: (
      { id }: { id: string },
      _: any,
      { commentService }: Context
    ) => commentService.findPinnedByArticle(id),
    comments: (
      { id }: { id: string },
      { input: { offset, limit } }: BatchParams,
      { commentService }: Context
    ) => commentService.findByArticleInBatch(id, offset, limit)
  },
  Comment: {
    id: ({ id }: { id: string }) => {
      return toGlobalId({ type: 'Comment', id })
    },
    article: (
      { articleId }: { articleId: string },
      _: any,
      { articleService }: Context
    ) => articleService.idLoader.load(articleId),
    author: (
      { authorId }: { authorId: string },
      _: any,
      { userService }: Context
    ) => userService.idLoader.load(authorId),
    upvotes: ({ id }: { id: string }, _: any, { commentService }: Context) =>
      commentService.countUpVote(id),
    downvotes: ({ id }: { id: string }, _: any, { commentService }: Context) =>
      commentService.countDownVote(id),
    myVote: (parent: any, _: any, { userService }: Context) => 'up_vote',
    mentions: (
      { mentionedUserId }: { mentionedUserId: [string] },
      _: any,
      { userService }: Context
    ) => userService.idLoader.loadMany(mentionedUserId),
    comments: ({ id }: { id: string }, _: any, { commentService }: Context) =>
      commentService.findByParent(id),
    parentComment: (
      { parentCommentId }: { parentCommentId: string },
      _: any,
      { commentService }: Context
    ) =>
      parentCommentId ? commentService.idLoader.load(parentCommentId) : null
  }
}
