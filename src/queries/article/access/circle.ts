import { CIRCLE_STATE } from 'common/enums'
import { ArticleAccessToCircleResolver } from 'definitions'

export const circle: ArticleAccessToCircleResolver = async (
  { articleId },
  _,
  { dataSources: { atomService }, knex }
) => {
  const articleCircle = await knex
    .select('article_circle.*')
    .from('article_circle')
    .join('circle', 'article_circle.circle_id', 'circle.id')
    .where({
      'article_circle.article_id': articleId,
      'circle.state': CIRCLE_STATE.active,
    })
    .first()

  if (!articleCircle || !articleCircle.circleId) {
    return
  }

  return atomService.circleIdLoader.load(articleCircle.circleId)
}