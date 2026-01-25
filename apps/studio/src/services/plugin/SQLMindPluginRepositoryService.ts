import { Manifest, PluginRepository, Release } from "./types";
import path from "path";
import fs from "fs";
import rawLog from "@bksLogger";

const log = rawLog.scope("SQLMindPluginRepositoryService");

/**
 * Custom plugin repository service for SQLMind Studio
 * Uses bundled plugins instead of loading from external registry
 */
export default class SQLMindPluginRepositoryService {
  private bundledPluginsPath: string;

  constructor() {
    // Path to bundled plugins in the app resources
    // In production: resources/plugins
    // In development: check multiple possible locations
    const workspacePluginPath = path.resolve(__dirname, "..", "..", "..", "..", "plugin");
    const isDev = process.env.NODE_ENV === 'development';

    // Prefer workspace plugins folder when running from source (so changes to
    // bundled plugin README/manifest reflect immediately in the app UI).
    if (fs.existsSync(workspacePluginPath)) {
      this.bundledPluginsPath = workspacePluginPath;
    } else if (isDev) {
      // Development fallback: use the plugin folder in the project root
      this.bundledPluginsPath = workspacePluginPath;
    } else {
      // Production: use the resources/plugins folder
      this.bundledPluginsPath = path.join(process.resourcesPath, "plugins");
    }
    
    log.info(`Bundled plugins path: ${this.bundledPluginsPath}`);
    log.info(`Path exists: ${fs.existsSync(this.bundledPluginsPath)}`);
  }

  /**
   * Fetch the latest release from bundled plugin
   */
  async fetchLatestRelease(_owner: string, repo: string): Promise<Release> {
    if (!fs.existsSync(this.bundledPluginsPath)) {
      throw new Error(
        `Bundled plugins folder is missing at "${this.bundledPluginsPath}". ` +
          `This build does not include bundled plugins.`
      );
    }
    // For bundled plugins, we ignore owner and use repo as the plugin ID
    const pluginId = repo;
    
    // In development, the folder might have a version suffix (e.g., bks-ai-shell-1.6.5)
    // In production, it will be just the plugin ID (e.g., bks-ai-shell)
    let pluginFolder = pluginId;
    let manifestPath = path.join(this.bundledPluginsPath, pluginFolder, "manifest.json");
    
    // If not found, try with version suffix in development
    if (!fs.existsSync(manifestPath)) {
      const dirs = fs.readdirSync(this.bundledPluginsPath);
      const matchingDir = dirs.find(dir => dir.startsWith(pluginId));
      if (matchingDir) {
        pluginFolder = matchingDir;
        manifestPath = path.join(this.bundledPluginsPath, pluginFolder, "manifest.json");
      }
    }
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Bundled plugin "${pluginId}" not found at ${manifestPath}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest: Manifest = JSON.parse(manifestContent);

    log.info(`Loaded bundled plugin: ${manifest.name} v${manifest.version}`);

    // For bundled plugins, use a special URL to indicate local bundled plugin
    // The PluginFileManager will detect this and copy instead of download
    const bundledPluginPath = path.join(this.bundledPluginsPath, pluginFolder);
    return {
      manifest,
      sourceArchiveUrl: `file://${bundledPluginPath}`,
    };
  }

  /**
   * Fetch the plugin registry
   * Returns a list of bundled plugins
   */
  async fetchRegistry() {
    if (!fs.existsSync(this.bundledPluginsPath)) {
      log.warn(
        `Bundled plugins folder missing at "${this.bundledPluginsPath}". Returning empty plugin registry.`
      );
      return [];
    }
    const registry = [
      {
        id: "bks-ai-shell",
        name: "AI Mode",
        description: "Ask AI to analyze your database and generate SQL queries.",
        author: {
          name: "SQLMind Studio",
          url: "https://sqltools.co"
        },
        repo: "sqlmind-studio/bks-ai-shell"
      }
    ];

    log.info(`Loaded ${registry.length} bundled plugins`);
    return registry;
  }

  /**
   * Fetch plugin repository information
   */
  async fetchPluginRepository(owner: string, repo: string): Promise<PluginRepository> {
    const latestRelease = await this.fetchLatestRelease(owner, repo);
    const readme = await this.fetchReadme(owner, repo);
    return { latestRelease, readme };
  }

  /**
   * Fetch README for the plugin
   */
  async fetchReadme(_owner: string, repo: string): Promise<string> {
    if (!fs.existsSync(this.bundledPluginsPath)) {
      return `# AI Mode\n\nBundled plugins are not included in this build.`;
    }
    const pluginId = repo;
    
    // Find the plugin folder (same logic as fetchLatestRelease)
    let pluginFolder = pluginId;
    let readmePath = path.join(this.bundledPluginsPath, pluginFolder, "README.md");
    
    if (!fs.existsSync(readmePath)) {
      const dirs = fs.readdirSync(this.bundledPluginsPath);
      const matchingDir = dirs.find(dir => dir.startsWith(pluginId));
      if (matchingDir) {
        pluginFolder = matchingDir;
        readmePath = path.join(this.bundledPluginsPath, pluginFolder, "README.md");
      }
    }
    
    if (fs.existsSync(readmePath)) {
      return fs.readFileSync(readmePath, "utf-8");
    }

    // Return default README if not found
    return `# AI Mode

Ask AI to analyze your database and generate SQL queries.

## Features

- Natural language to SQL conversion
- Database schema analysis
- Query optimization suggestions
- Multiple AI providers (OpenAI, Anthropic, Google)

## Requirements

This is a premium feature that requires a SQLMind Studio license.

Visit [sqltools.co](https://sqltools.co) for more information.
`;
  }
}
