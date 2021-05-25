const { alterEnumString } = require('../utils')

const table = 'transaction'

exports.up = (knex) =>
  knex.raw(
    `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "transaction_purpose_check1";`
  )

exports.down = (knex, Promise) => Promise.resolve()
