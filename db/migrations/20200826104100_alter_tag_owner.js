const table = 'tag'
const column = 'owner'

exports.up = (knex) =>
  knex.schema.table(table, function (t) {
    t.bigInteger(column).unsigned().nullable()
  })

exports.down = (knex) =>
  knex.raw(/*sql*/ `
    ALTER TABLE ${table}
    DROP COLUMN ${column} CASCADE;`)
