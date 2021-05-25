const table = 'user_reader_materialized'

exports.up = (knex) =>
  knex.raw(/*sql*/ `
  create materialized view ${table} as
      select *
      from user_reader_view
  `)

exports.down = (knex) =>
  knex.raw(/*sql*/ `drop materialized view if exists ${table}`)
