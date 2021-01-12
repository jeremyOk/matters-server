import bodyParser from 'body-parser'
import { Router } from 'express'
import _ from 'lodash'
import Stripe from 'stripe'

import {
  PAYMENT_CURRENCY,
  PAYMENT_PROVIDER,
  SLACK_MESSAGE_STATE,
  TRANSACTION_PURPOSE,
  TRANSACTION_STATE,
  TRANSACTION_TARGET_TYPE,
} from 'common/enums'
import { environment } from 'common/environment'
import logger from 'common/logger'
import { numRound, toDBAmount } from 'common/utils'
import { NotificationService, PaymentService, UserService } from 'connectors'
import SlackService from 'connectors/slack'

const stripe = new Stripe(environment.stripeSecret, {
  apiVersion: '2020-08-27',
})

const stripeRouter = Router()

const mappingTxPurposeToMailType = (type: TRANSACTION_PURPOSE) => {
  switch (type) {
    case TRANSACTION_PURPOSE.addCredit:
      return 'creditAdded'
    case TRANSACTION_PURPOSE.payout:
      return 'payout'
  }
}

const updateTxState = async (
  paymentIntent: Stripe.PaymentIntent,
  eventType:
    | 'payment_intent.canceled'
    | 'payment_intent.payment_failed'
    | 'payment_intent.processing'
    | 'payment_intent.succeeded',
  remark?: string | null
) => {
  const userService = new UserService()
  const paymentService = new PaymentService()
  const notificationService = new NotificationService()

  // find transaction by payment intent id
  const transaction = (
    await paymentService.findTransactions({
      providerTxId: paymentIntent.id,
    })
  )[0]

  if (!transaction) {
    return
  }

  // update transaction's state
  const eventStateMap = {
    'payment_intent.canceled': TRANSACTION_STATE.canceled,
    'payment_intent.payment_failed': TRANSACTION_STATE.failed,
    'payment_intent.processing': TRANSACTION_STATE.pending,
    'payment_intent.succeeded': TRANSACTION_STATE.succeeded,
  }

  const tx = await paymentService.markTransactionStateAs({
    id: transaction.id,
    state: eventStateMap[eventType],
    remark,
  })

  // trigger notifications
  const mailType = mappingTxPurposeToMailType(tx.purpose)
  if (eventType === 'payment_intent.succeeded' && mailType) {
    const isPayout = tx.purpose === TRANSACTION_PURPOSE.payout
    const recipient = await userService.baseFindById(
      isPayout ? tx.senderId : tx.recipientId
    )
    notificationService.mail.sendPayment({
      to: recipient.email,
      recipient: {
        displayName: recipient.displayName,
        userName: recipient.userName,
      },
      type: mailType,
      tx: {
        recipient,
        amount: numRound(isPayout ? tx.amount - tx.fee : tx.amount),
        currency: tx.currency,
      },
    })

    // send slack message
    if (isPayout) {
      const slack = new SlackService()
      if (slack) {
        slack.sendPayoutMessage({
          amount: tx.amount,
          fee: tx.fee,
          state: SLACK_MESSAGE_STATE.successful,
          txId: tx.providerTxId,
          userName: recipient.userName,
        })
      }
    }
  }
}

const createRefundTxs = async (refunds: Stripe.ApiList<Stripe.Refund>) => {
  const paymentService = new PaymentService()

  await Promise.all(
    refunds.data.map(async (refund) => {
      const refundTx = (
        await paymentService.findTransactions({
          providerTxId: refund.id,
        })
      )[0]

      // skip if refund transaction exists
      if (refundTx) {
        return
      }

      const paymentTx = (
        await paymentService.findTransactions({
          providerTxId: refund.payment_intent as string,
        })
      )[0]

      // skip if related payment transaction doesn't exists
      if (!paymentTx) {
        return
      }

      // create a refund transaction,
      // and link with payment intent transaction
      await paymentService.createTransaction({
        amount: toDBAmount({ amount: refund.amount }),

        state: TRANSACTION_STATE.succeeded,
        currency: _.upperCase(refund.currency) as PAYMENT_CURRENCY,
        purpose: TRANSACTION_PURPOSE.refund,

        provider: PAYMENT_PROVIDER.stripe,
        providerTxId: refund.id,

        recipientId: undefined,
        senderId: paymentTx.recipientId,

        targetId: paymentTx.id,
        targetType: TRANSACTION_TARGET_TYPE.transaction,
      })
    })
  )
}

/**
 * Handling Incoming Stripe Events
 *
 * @see {@url https://stripe.com/docs/webhooks}
 */

stripeRouter.use(bodyParser.raw({ type: 'application/json' }))

stripeRouter.post('/', async (req, res) => {
  const paymentService = new PaymentService()

  const sig = req.headers['stripe-signature'] as string

  let event: Stripe.Event | null = null

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      environment.stripeWebhookSecret
    )
  } catch (err) {
    logger.error(err)
    res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (!event) {
    return res.status(400).send(`Webhook Error: empty event object`)
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.canceled':
      const canceled = event.data.object as Stripe.PaymentIntent
      await updateTxState(canceled, event.type, canceled.cancellation_reason)
      break
    case 'payment_intent.payment_failed':
      const failed = event.data.object as Stripe.PaymentIntent
      await updateTxState(failed, event.type, failed.last_payment_error?.code)
      break
    case 'payment_intent.processing':
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      await updateTxState(paymentIntent, event.type)
      break
    case 'charge.refunded':
      const charge = event.data.object as Stripe.Charge
      await createRefundTxs(charge.refunds)
      break
    case 'customer.deleted':
      const customer = event.data.object as Stripe.Customer
      await paymentService.deleteCustomer({ customerId: customer.id })
      break
    default:
      logger.error('Unexpected event type', event.type)
      break
  }

  // Return a 200 res to acknowledge receipt of the event
  res.json({ received: true })
})

export default stripeRouter
