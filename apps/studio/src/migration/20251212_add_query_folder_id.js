export default {
  name: '20251212_add_query_folder_id',
  async run(runner) {
    await runner.query(`
      ALTER TABLE favorite_query ADD COLUMN queryFolderId INTEGER
    `);
  }
}
