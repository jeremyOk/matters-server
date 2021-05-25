exports.up = (knex) =>
  knex('user').where({ state: 'onboarding' }).update({ state: 'active' })

exports.down = (knex, Promise) => Promise.resolve()
