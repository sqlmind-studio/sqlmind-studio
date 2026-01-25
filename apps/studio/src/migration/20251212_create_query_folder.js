export default {
  name: '20251212_create_query_folder',
  async run(runner) {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS query_folder (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        workspaceId INTEGER NOT NULL DEFAULT -1,
        createdAt DATETIME NOT NULL DEFAULT (datetime('now')),
        updatedAt DATETIME NOT NULL DEFAULT (datetime('now')),
        version INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
}
