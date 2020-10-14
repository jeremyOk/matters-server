import { v4 } from 'uuid'

import {
  ASSET_TYPE,
  BATCH_SIZE,
  SEARCH_KEY_TRUNCATE_LENGTH,
  SKIPPED_LIST_ITEM_TYPES,
} from 'common/enums'
import logger from 'common/logger'
import { BaseService } from 'connectors'
import {
  GQLFeatureFlag,
  GQLFeatureName,
  SkippedListItemType,
} from 'definitions'

export class SystemService extends BaseService {
  featureFlagTable: string

  constructor() {
    super('noop')

    this.featureFlagTable = 'feature_flag'
  }

  /*********************************
   *                               *
   *           Search              *
   *                               *
   *********************************/
  frequentSearch = async ({
    key = '',
    first = 5,
  }: {
    key?: string
    first?: number
  }) => {
    const query = this.knex('search_history')
      .select('search_key')
      .count('id')
      .whereNot({ searchKey: '' })
      .groupBy('search_key')
      .orderBy('count', 'desc')
      .limit(first)

    if (key) {
      query.where('search_key', 'like', `%${key}%`)
    } else {
      query.where(
        'created_at',
        '>=',
        this.knex.raw(`now() -  interval '14 days'`)
      )
    }

    const result = await query

    return result.map(({ searchKey }) =>
      (searchKey as string).slice(0, SEARCH_KEY_TRUNCATE_LENGTH)
    )
  }

  /*********************************
   *                               *
   *            Features           *
   *                               *
   *********************************/

  getFeatureFlags = () => this.knex(this.featureFlagTable).select('*').limit(50)

  getFeatureFlag = async (
    name: GQLFeatureName | keyof typeof GQLFeatureName
  ) => {
    const [featureFlag] = await this.knex(this.featureFlagTable).where({ name })
    return featureFlag
  }

  setFeatureFlag = async ({
    name,
    flag,
  }: {
    name: GQLFeatureName | keyof typeof GQLFeatureName
    flag: GQLFeatureFlag | keyof typeof GQLFeatureFlag
  }) => {
    const [featureFlag] = await this.knex
      .where({ name })
      .update({
        name,
        flag,
        updatedAt: this.knex.fn.now(),
      })
      .into(this.featureFlagTable)
      .returning('*')
    return featureFlag
  }

  /*********************************
   *                               *
   *              Asset            *
   *                               *
   *********************************/
  /**
   * Create asset and asset_map
   */
  createAssetAndAssetMap = async (
    asset: { [key: string]: any },
    entityTypeId: string,
    entityId: string
  ) =>
    this.knex.transaction(async (trx) => {
      const [newAsset] = await trx.insert(asset).into('asset').returning('*')

      await trx
        .insert({
          assetId: newAsset.id,
          entityTypeId,
          entityId,
        })
        .into('asset_map')

      return newAsset
    })

  /**
   * Find asset by a given uuid
   */
  findAssetByUUID = async (uuid: string) => this.baseFindByUUID(uuid, 'asset')

  /**
   * Find assets by given uuids
   */
  findAssetByUUIDs = async (uuids: string[]) =>
    this.baseFindByUUIDs(uuids, 'asset')

  /**
   * Find the url of an asset by a given id.
   */
  findAssetUrl = async (id: string): Promise<string | null> => {
    const result = await this.baseFindById(id, 'asset')
    return result && result.path
      ? `${this.aws.s3Endpoint}/${result.path}`
      : null
  }

  /**
   * Find asset and asset map by given entity type and id
   */
  findAssetAndAssetMap = async ({
    entityTypeId,
    entityId,
    assetType,
  }: {
    entityTypeId: string
    entityId: string
    assetType?: keyof typeof ASSET_TYPE
  }) => {
    let qs = this.knex('asset_map')
      .select('asset_map.*', 'uuid', 'path', 'type', 'created_at')
      .rightJoin('asset', 'asset_map.asset_id', 'asset.id')
      .where({ entityTypeId, entityId })

    if (assetType) {
      qs = qs.andWhere({ type: assetType })
    }

    return qs
  }

  /**
   * Swap entity of asset map by given ids
   */
  swapAssetMapEntity = async (
    assetMapIds: string[],
    entityTypeId: string,
    entityId: string
  ) =>
    this.knex('asset_map').whereIn('id', assetMapIds).update({
      entityTypeId,
      entityId,
    })

  /**
   * Delete asset and asset map by the given id:path maps
   */
  deleteAssetAndAssetMap = async (assetPaths: { [id: string]: string }) => {
    const ids = Object.keys(assetPaths)
    const paths = Object.keys(assetPaths)

    await this.knex.transaction(async (trx) => {
      await trx('asset_map').whereIn('asset_id', ids).del()
      await trx('asset').whereIn('id', ids).del()
    })

    try {
      await Promise.all(paths.map((path) => this.aws.baseDeleteFile(path)))
    } catch (e) {
      logger.error(e)
    }
  }

  /**
   * Find or Delete assets by given author id and types
   */
  findAssetsByAuthorAndTypes = (authorId: string, types: string[]) =>
    this.knex('asset').whereIn('type', types).andWhere({ authorId })

  /*********************************
   *                               *
   *            Log Record         *
   *                               *
   *********************************/
  findLogRecord = async (where: { [key: string]: string | boolean }) =>
    this.knex.select().from('log_record').where(where).first()

  logRecord = async (data: { userId: string; type: string }) => {
    return this.baseUpdateOrCreate({
      where: data,
      data: { readAt: new Date(), ...data },
      table: 'log_record',
    })
  }

  /*********************************
   *                               *
   *           Skipped             *
   *                               *
   *********************************/
  findSkippedItems = async ({
    types,
    limit = BATCH_SIZE,
    offset = 0,
  }: {
    types: string[]
    limit?: number
    offset?: number
  }) =>
    this.knex('blocklist')
      .whereIn('type', types)
      .limit(limit)
      .offset(offset)
      .orderBy('id', 'desc')

  findSkippedItem = async (type: SkippedListItemType, value: string) => {
    return this.knex('blocklist').where({ type, value }).first()
  }

  countSkippedItems = async ({ types }: { types: string[] }) => {
    const result = await this.knex('blocklist')
      .whereIn('type', types)
      .count()
      .first()

    return parseInt(result ? (result.count as string) : '0', 10)
  }

  createSkippedItem = async ({
    type,
    value,
    uuid,
    note,
    archived,
  }: {
    type: SkippedListItemType
    value: string
    uuid?: string
    note?: string
    archived?: boolean
  }) => {
    const where = { type, value }

    return this.baseUpdateOrCreate({
      where,
      data: {
        type,
        value,
        note,
        archived,
        uuid: uuid || v4(),
        updatedAt: new Date(),
      },
      table: 'blocklist',
    })
  }

  saveAgentHash = async (value: string, note?: string) => {
    if (!value) {
      return
    }
    return this.createSkippedItem({
      type: SKIPPED_LIST_ITEM_TYPES.AGENT_HASH,
      uuid: v4(),
      value,
      note,
    })
  }

  updateSkippedItem = async (
    where: Record<string, any>,
    data: Record<string, any>
  ) => {
    const [updateItem] = await this.knex
      .where(where)
      .update(data)
      .into('blocklist')
      .returning('*')
    return updateItem
  }
}
