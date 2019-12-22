import Queue from 'bull'
import * as cheerio from 'cheerio'

import {
  NODE_TYPES,
  PUBLISH_ARTICLE_DELAY,
  PUBLISH_STATE,
  QUEUE_CONCURRENCY,
  QUEUE_JOB,
  QUEUE_NAME,
  QUEUE_PRIORITY
} from 'common/enums'
import { isTest } from 'common/environment'
import logger from 'common/logger'
import { extractAssetDataFromHtml, fromGlobalId } from 'common/utils'
import {
  ArticleService,
  CacheService,
  DraftService,
  NotificationService,
  SystemService,
  TagService,
  UserService
} from 'connectors'

import { createQueue } from './utils'

class PublicationQueue {
  q: InstanceType<typeof Queue>
  tagService: InstanceType<typeof TagService>
  articleService: InstanceType<typeof ArticleService>
  cacheService: InstanceType<typeof CacheService>
  draftService: InstanceType<typeof DraftService>
  notificationService: InstanceType<typeof NotificationService>
  systemService: InstanceType<typeof SystemService>
  userService: InstanceType<typeof UserService>

  private queueName = QUEUE_NAME.publication

  constructor() {
    this.notificationService = new NotificationService()
    this.tagService = new TagService()
    this.articleService = new ArticleService()
    this.cacheService = new CacheService()
    this.draftService = new DraftService()
    this.systemService = new SystemService()
    this.userService = new UserService()
    this.q = createQueue(this.queueName)
    this.addConsumers()
  }

  /**
   * Producers
   */
  publishArticle = ({
    draftId,
    delay = PUBLISH_ARTICLE_DELAY
  }: {
    draftId: string
    delay?: number
  }) => {
    return this.q.add(
      QUEUE_JOB.publishArticle,
      { draftId },
      {
        delay,
        priority: QUEUE_PRIORITY.CRITICAL
      }
    )
  }

  /**
   * Cusumers
   */
  private addConsumers = () => {
    if (isTest) {
      return
    }

    this.q.process(
      QUEUE_JOB.publishArticle,
      QUEUE_CONCURRENCY.publishArticle,
      async (job, done) => {
        try {
          const { draftId } = job.data as { draftId: string }
          const draft = await this.draftService.baseFindById(draftId)

          // checks
          if (draft.publishState !== PUBLISH_STATE.pending) {
            job.progress(100)
            done(null, `Publication of draft ${draftId} is not pending.`)
            return
          }

          if (draft.scheduledAt && draft.scheduledAt > new Date()) {
            job.progress(100)
            done(null, `Draft's (${draftId}) scheduledAt is greater than now`)
            return
          }
          job.progress(5)

          // publish to IPFS
          let article: any
          try {
            article = await this.articleService.publish(draft)
          } catch (e) {
            await this.draftService.baseUpdate(draft.id, {
              publishState: PUBLISH_STATE.error
            })
            throw e
          }
          job.progress(10)

          // mark draft as published
          await this.draftService.baseUpdate(draft.id, {
            archived: true,
            publishState: PUBLISH_STATE.published,
            updatedAt: new Date()
          })
          job.progress(20)

          // handle collection
          await this.handleCollection({ draft, article })
          job.progress(40)

          const [
            { id: draftEntityTypeId },
            { id: articleEntityTypeId }
          ] = await Promise.all([
            this.systemService.baseFindEntityTypeId('draft'),
            this.systemService.baseFindEntityTypeId('article')
          ])

          // Remove unused assets
          await this.deleteUnusedAssets({ draftEntityTypeId, draft })
          job.progress(45)

          // Swap assets from draft to article
          await this.systemService.replaceAssetMapEntityTypeAndId(
            draftEntityTypeId,
            draft.id,
            articleEntityTypeId,
            article.id
          )
          job.progress(50)

          // handle tags
          const tags = await this.handleTags({ draft, article })
          job.progress(60)

          // add to search
          const author = await this.userService.baseFindById(article.authorId)
          const { userName, displayName } = author
          await this.articleService.addToSearch({
            ...article,
            userName,
            displayName,
            tags
          })
          job.progress(80)

          // handle mentions
          await this.handleMentions({ article })
          job.progress(90)

          // trigger notifications
          this.notificationService.trigger({
            event: 'article_published',
            recipientId: article.authorId,
            entities: [
              {
                type: 'target',
                entityTable: 'article',
                entity: article
              }
            ]
          })
          job.progress(95)

          // invalidate user cache
          await this.cacheService.invalidate(NODE_TYPES.user, article.authorId)
          job.progress(100)

          done(null, {
            dataHash: article.dataHash,
            mediaHash: article.mediaHash
          })
        } catch (e) {
          done(e)
        }
      }
    )
  }

  /**
   * Create collections
   */
  private handleCollection = async ({
    draft,
    article
  }: {
    draft: any
    article: any
  }) => {
    if (!draft.collection || draft.collection.length <= 0) {
      return
    }

    // create collection records
    await this.articleService.createCollection({
      entranceId: article.id,
      articleIds: draft.collection
    })

    // trigger notifications
    draft.collection.forEach(async (id: string) => {
      const collection = await this.articleService.baseFindById(id)
      this.notificationService.trigger({
        event: 'article_new_collected',
        recipientId: collection.authorId,
        actorId: article.authorId,
        entities: [
          {
            type: 'target',
            entityTable: 'article',
            entity: collection
          },
          {
            type: 'collection',
            entityTable: 'article',
            entity: article
          }
        ]
      })
    })
  }

  /**
   * Create tags
   */
  private handleTags = async ({
    draft,
    article
  }: {
    draft: any
    article: any
  }) => {
    let tags = draft.tags

    if (tags && tags.length > 0) {
      // get tag editor
      const mattyUser = await this.userService.findByEmail('hi@matters.news')
      const tagEditors = mattyUser ? [mattyUser.id] : []

      // create tag records, return tag record if already exists
      const dbTags = ((await Promise.all(
        tags.map((tag: string) =>
          this.tagService.create({ content: tag, editors: tagEditors })
        )
      )) as unknown) as [{ id: string; content: string }]

      // create article_tag record
      await this.tagService.createArticleTags({
        articleIds: [article.id],
        tagIds: dbTags.map(({ id }) => id)
      })
    } else {
      tags = []
    }

    return tags
  }

  /**
   * Notice mentioned users
   */
  private handleMentions = async ({ article }: { article: any }) => {
    const $ = cheerio.load(article.content)
    const mentionIds = $('a.mention')
      .map((index: number, node: any) => {
        const id = $(node).attr('data-id')
        if (id) {
          return id
        }
      })
      .get()

    mentionIds.forEach((id: string) => {
      const { id: recipientId } = fromGlobalId(id)

      if (!recipientId) {
        return false
      }

      this.notificationService.trigger({
        event: 'article_mentioned_you',
        actorId: article.authorId,
        recipientId,
        entities: [
          {
            type: 'target',
            entityTable: 'article',
            entity: article
          }
        ]
      })
    })
  }

  /**
   * Delete unused assets from S3 and DB, skip if error is thrown.
   *
   */
  private deleteUnusedAssets = async ({
    draftEntityTypeId,
    draft
  }: {
    draftEntityTypeId: string
    draft: any
  }) => {
    try {
      const [assetMap, uuids] = await Promise.all([
        this.systemService.findAssetMap(draftEntityTypeId, draft.id),
        extractAssetDataFromHtml(draft.content)
      ])
      const assets = assetMap.reduce((data: any, asset: any) => {
        if (uuids && !uuids.includes(asset.uuid)) {
          data[`${asset.assetId}`] = asset.path
        }
        return data
      }, {})

      if (assets && Object.keys(assets).length > 0) {
        await this.systemService.deleteAssetAndAssetMap(assets)
      }
    } catch (e) {
      logger.error(e)
    }
  }
}

export const publicationQueue = new PublicationQueue()
