const table = 'user'

exports.up = (knex) =>
  knex(table)
    .where({
      state: 'onboarding',
    })
    .update('state', 'active')

exports.down = (knex, Promise) => Promise.resolve()
