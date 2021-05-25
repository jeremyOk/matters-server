const table = 'article_read_count'
const column = 'read_time'

exports.up = async (knex) => {
  await knex.schema.table(table, (t) => {
    t.bigInteger(column).defaultTo(0)
  })
}

exports.down = (knex) =>
  knex.raw(
    /*sql*/ `alter table "${table}" drop column if exists ${column} cascade`
  )
