import { AuthenticationError, UserInputError } from 'apollo-server'
import { MutationToClearReadHistoryResolver } from 'definitions'
import { fromGlobalId } from 'common/utils'

const resolver: MutationToClearReadHistoryResolver = async (
  _,
  { input: { id } },
  { viewer, dataSources: { userService } }
) => {
  await userService.clearReadHistory({
    articleId: fromGlobalId(id).id,
    userId: viewer.id
  })

  return true
}

export default resolver
