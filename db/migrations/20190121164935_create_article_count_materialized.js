const table = 'article_count_materialized'

exports.up = (knex) =>
  knex.raw(/*sql*/ `
  create materialized view ${table} as
        select *
        from article_count_view
  `)

exports.down = (knex) =>
  knex.raw(/*sql*/ `drop materialized view if exists ${table}`)
