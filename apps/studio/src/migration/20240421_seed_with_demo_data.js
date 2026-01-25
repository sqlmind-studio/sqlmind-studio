import platformInfo from '@/common/platform_info'
import rawLog from '@bksLogger'
import { copyFileSync } from 'fs'
import path from 'path'

const log = rawLog.scope('migrations/seed')

function escapeString(value, quote) {
  if (!value) return null
  const result = `${value.toString().replaceAll(/'/g, "''")}`
  return quote ? `'${result}'` : result
}


const demoQuerySql = escapeString(`
-- You can run this script directly to see how data is queried in this database.
-- Press "ctrl/cmd+enter" to run the query and see the results. Yum.

SELECT
    cheeses.name AS Cheese,
    cheeses.cheese_type AS Type,
    cheeses.description AS Description,
    countries.name AS OriginCountry
FROM
    cheeses
JOIN
    countries ON cheeses.origin_country_id = countries.id;


-- Other stuff to try:
-- <= Double click tables to view (and edit!) their data
-- <= Right click a table and click 'Export to file' to make a CSV
-- <= Click the <> Icon in the right sidebar to see saved queries

-- Links:
-- SQLMind Studio Docs: https://sqltools.co
-- Website: https://sqltools.co

`, true)


export default {
  name: "20240421_seed_with_demo_data",
  async run(runner) {
    // Demo database creation disabled for SQLMind Studio
    log.info("Demo database creation is disabled")
    return
  }
};
