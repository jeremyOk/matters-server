const table = 'user'

exports.up = (knex) => knex(table).update('state', 'onboarding')

exports.down = (knex, Promise) => Promise.resolve()
