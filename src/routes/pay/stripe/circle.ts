import { invalidateFQC } from '@matters/apollo-response-cache'
import _ from 'lodash'
import Stripe from 'stripe'

import {
  CIRCLE_ACTION,
  CIRCLE_STATE,
  DB_NOTICE_TYPE,
  METADATA_KEY,
  NODE_TYPES,
  PAYMENT_CURRENCY,
  PAYMENT_PROVIDER,
  PRICE_STATE,
} from 'common/enums'
import { ServerError } from 'common/errors'
import logger from 'common/logger'
import { toDBAmount } from 'common/utils'
import {
  AtomService,
  CacheService,
  NotificationService,
  PaymentService,
} from 'connectors'
import SlackService from 'connectors/slack'
import { CirclePrice, CircleSubscription, Customer } from 'definitions'

/**
 * Complete the circle subscription that
 * occurs by `/src/mutations/circle/subscribeCircle.ts`
 * on setupIntent is succeeded
 *
 * @param setupIntent
 * @param dbCustomer
 */
export const completeCircleSubscription = async ({
  setupIntent,
  dbCustomer,
  event,
}: {
  setupIntent: Stripe.SetupIntent
  dbCustomer: Customer
  event: Stripe.Event
}) => {
  const atomService = new AtomService()
  const paymentService = new PaymentService()
  const notificationService = new NotificationService()
  const slack = new SlackService()
  const slackEventData = {
    id: event.id,
    type: event.type,
  }

  const metadata = setupIntent.metadata
  const userId = dbCustomer.userId
  const circleId = _.get(metadata, METADATA_KEY.CIRCLE_ID)
  const priceId = _.get(metadata, METADATA_KEY.CIRCLE_PRICE_ID)

  // check circle, price & customer
  if (!circleId || !priceId) {
    return
  }

  const [circle, price, customer] = await Promise.all([
    atomService.findFirst({
      table: 'circle',
      where: { id: circleId, state: CIRCLE_STATE.active },
    }),
    atomService.findFirst({
      table: 'circle_price',
      where: { circleId, state: PRICE_STATE.active },
    }),
    atomService.findFirst({
      table: 'customer',
      where: {
        userId,
        provider: PAYMENT_PROVIDER.stripe,
        archived: false,
      },
    }),
  ])

  if (!circle || !price || !customer) {
    slack.sendStripeAlert({
      data: slackEventData,
      message: `can't find circle (${circleId}), price (${priceId}) or customer.`,
    })
    return
  }

  const subscriptions = await paymentService.findActiveSubscriptions({ userId })

  await paymentService.createSubscriptionOrItem({
    userId,
    priceId: price.id,
    providerPriceId: price.providerPriceId,
    providerCustomerId: customer.customerId,
    subscriptions,
  })

  // trigger notificaiton
  notificationService.trigger({
    event: DB_NOTICE_TYPE.circle_new_subscriber,
    actorId: userId,
    recipientId: circle.owner,
    entities: [
      {
        type: 'target',
        entityTable: 'circle',
        entity: circle,
      },
    ],
  })

  // auto follow circle without notification
  const hasFollow = await atomService.count({
    table: 'action_circle',
    where: {
      action: CIRCLE_ACTION.follow,
      userId,
      targetId: circleId,
    },
  })
  if (hasFollow === 0) {
    await atomService.create({
      table: 'action_circle',
      data: {
        action: CIRCLE_ACTION.follow,
        userId,
        targetId: circleId,
      },
    })
  }

  // invalidate user & circle
  const cacheService = new CacheService()
  invalidateFQC({
    node: { type: NODE_TYPES.Circle, id: circle.id },
    redis: cacheService.redis,
  })
  invalidateFQC({
    node: { type: NODE_TYPES.User, id: userId },
    redis: cacheService.redis,
  })
}

/**
 * Sync db subscription with Stripe
 *
 * @param subscription
 */
export const updateSubscription = async ({
  subscription,
  event,
}: {
  subscription: Stripe.Subscription
  event: Stripe.Event
}) => {
  const atomService = new AtomService()
  const paymentService = new PaymentService()
  const cacheService = new CacheService()
  const slack = new SlackService()
  const slackEventData = {
    id: event.id,
    type: event.type,
  }

  const dbSub = await atomService.findFirst({
    table: 'circle_subscription',
    where: { providerSubscriptionId: subscription.id },
  })

  if (!dbSub) {
    slack.sendStripeAlert({
      data: slackEventData,
      message: `can't find subscription ${subscription.id}.`,
    })
    return
  }

  const isSubStateChanged = dbSub.state !== subscription.status
  const userId = dbSub.userId
  const subscriptionId = dbSub.id

  /**
   * sync subscription
   */
  if (isSubStateChanged) {
    try {
      await atomService.update({
        table: 'circle_subscription',
        where: { id: dbSub.id },
        data: {
          state: subscription.status,
          canceledAt: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000)
            : undefined,
          updatedAt: new Date(),
        },
      })
    } catch (error) {
      logger.error(error)
      throw new ServerError('failed to update subscription')
    }
  }

  /**
   * sync subscription items
   */
  let addedPriceIds = []
  let removedPriceIds = []
  try {
    // retrieve all subscription items
    const [stripeSubItems, dbSubItems] = await Promise.all([
      paymentService.stripe.listSubscriptionItems(subscription.id),
      atomService.findMany({
        table: 'circle_subscription_item',
        where: { userId, subscriptionId, archived: false },
      }),
    ])

    if (!stripeSubItems) {
      return
    }

    const dbPriceIds = (
      await atomService.findMany({
        table: 'circle_price',
        whereIn: [
          'provider_price_id',
          stripeSubItems.data.map((item) => item.price.id),
        ],
      })
    ).map((item) => item.id)
    const dbCurrPriceIds = dbSubItems.map((item) => item.priceId)

    // added
    addedPriceIds = _.difference(dbPriceIds, dbCurrPriceIds)
    await Promise.all(
      addedPriceIds.map(async (priceId) => {
        const providerSubscriptionItemId = stripeSubItems.data.find(
          (item) => item.price.id === priceId
        )
        await atomService.create({
          table: 'circle_subscription_item',
          data: {
            subscriptionId,
            userId,
            priceId,
            provider: PAYMENT_PROVIDER.stripe,
            providerSubscriptionItemId,
          },
        })
      })
    )

    // removed
    removedPriceIds = _.difference(dbCurrPriceIds, dbPriceIds)
    await Promise.all(
      removedPriceIds.map(async (priceId) => {
        await atomService.update({
          table: 'circle_subscription_item',
          where: { userId, subscriptionId, priceId },
          data: { archived: true, updatedAt: new Date() },
        })
      })
    )
  } catch (error) {
    logger.error(error)
    throw new ServerError('failed to update subscription items')
  }

  // invalidate user & circle
  try {
    const dbDiffPrices = await atomService.findMany({
      table: 'circle_price',
      whereIn: ['id', [...addedPriceIds, ...removedPriceIds]],
    })
    invalidateFQC({
      node: { type: NODE_TYPES.User, id: dbSub.userId },
      redis: cacheService.redis,
    })
    dbDiffPrices.map((price) => {
      invalidateFQC({
        node: { type: NODE_TYPES.Circle, id: price.circleId },
        redis: cacheService.redis,
      })
    })
  } catch (error) {
    logger.error(error)
  }

  return
}

/**
 * handle circle invoice
 */
export const completeCircleInvoice = async ({
  invoice,
  event,
}: {
  invoice: Stripe.Invoice
  event: Stripe.Event
}) => {
  const slack = new SlackService()
  const slackEventData = {
    id: event.id,
    type: event.type,
  }
  logger.info(`proceeding ${event.type} event...`)
  try {
    const atomService = new AtomService()
    const paymentService = new PaymentService()
    const providerInvoiceId = invoice.id as string
    const providerTxId = invoice.payment_intent as string
    const amount = toDBAmount({ amount: invoice.amount_paid })
    const currency = _.toUpper(invoice.currency) as PAYMENT_CURRENCY
    const totalDiscount = invoice.total_discount_amounts
      ? toDBAmount({
          amount: invoice.total_discount_amounts.reduce(
            (sum, d) => sum + d.amount,
            0
          ),
        })
      : 0

    if (!providerTxId) {
      return
    }

    const tx = (await paymentService.findTransactions({ providerTxId }))[0]

    if (tx) {
      throw new ServerError(
        `transaction already exists for invoice ${providerInvoiceId}`
      )
    }

    // retrieve customer
    const customer = (await atomService.findFirst({
      table: 'customer',
      where: {
        customer_id: invoice.customer,
        provider: PAYMENT_PROVIDER.stripe,
        archived: false,
      },
    })) as Customer

    // retrieve subscription
    const subscription = (await atomService.findFirst({
      table: 'circle_subscription',
      where: {
        providerSubscriptionId: invoice.subscription,
        provider: PAYMENT_PROVIDER.stripe,
      },
    })) as CircleSubscription

    // retrieve prices
    const providerPriceIds = invoice.lines.data.map((item) =>
      item.price ? item.price.id : ''
    )
    const priceDiscounts = invoice.lines.data.map((item) => {
      if (item.price && item.discount_amounts) {
        return toDBAmount({
          amount: item.discount_amounts.reduce((sum, d) => sum + d.amount, 0),
        })
      }
      return 0
    })

    if (totalDiscount !== priceDiscounts.reduce((sum, amt) => sum + amt, 0)) {
      throw new ServerError(
        `total discount is not equal to sum of price discounts: ${providerInvoiceId}`
      )
    }

    const prices = (await atomService.findMany({
      table: 'circle_price',
      whereIn: ['providerPriceId', providerPriceIds],
    })) as CirclePrice[]

    if (customer && subscription && prices) {
      await paymentService.createInvoiceWithTransactions({
        amount,
        currency,
        providerTxId,
        providerInvoiceId,
        subscriptionId: subscription.id,
        userId: customer.userId,
        prices,
        discounts: priceDiscounts,
      })
    } else {
      throw new ServerError(`failed to complete invoice ${providerInvoiceId}`)
    }
  } catch (error) {
    logger.error(error)
    slack.sendStripeAlert({
      data: slackEventData,
      message: error,
    })
  }
}
