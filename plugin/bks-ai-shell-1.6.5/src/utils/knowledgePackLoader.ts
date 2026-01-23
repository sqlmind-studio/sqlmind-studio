// Dynamic knowledge pack loader
// Loads relevant SQL Server expert knowledge based on query context

// Import all knowledge pack files
import part1_architecture from "../../sql_expert_knowledge_pack_v2/sql_expert_part1_architecture.txt?raw";
import part2_indexing_waits from "../../sql_expert_knowledge_pack_v2/sql_expert_part2_indexing_waits.txt?raw";
import part3_concurrency from "../../sql_expert_knowledge_pack_v2/sql_expert_part3_concurrency_transactions.txt?raw";
import part4_partitioning from "../../sql_expert_knowledge_pack_v2/sql_expert_part4_partitioning_compression.txt?raw";
import part5_query_store from "../../sql_expert_knowledge_pack_v2/sql_expert_part5_query_store_tuning.txt?raw";
import part6_tempdb_memory from "../../sql_expert_knowledge_pack_v2/sql_expert_part6_tempdb_memory_io.txt?raw";
import part7_backup_hadr from "../../sql_expert_knowledge_pack_v2/sql_expert_part7_backup_restore_hadr.txt?raw";
import part8_security from "../../sql_expert_knowledge_pack_v2/sql_expert_part8_security_encryption.txt?raw";
import part9_monitoring from "../../sql_expert_knowledge_pack_v2/sql_expert_part9_monitoring_automation.txt?raw";
import part10_azure from "../../sql_expert_knowledge_pack_v2/sql_expert_part10_azure_cloud.txt?raw";
import part11_troubleshooting from "../../sql_expert_knowledge_pack_v2/sql_expert_part11_troubleshooting_cookbook.txt?raw";
import part12_reference from "../../sql_expert_knowledge_pack_v2/sql_expert_part12_reference_queries.txt?raw";

interface KnowledgePack {
  name: string;
  content: string;
  keywords: string[];
  priority: number; // Higher = more important for this topic
}

const knowledgePacks: KnowledgePack[] = [
  {
    name: "Architecture & Storage",
    content: part1_architecture,
    keywords: ["architecture", "storage engine", "buffer pool", "page", "extent", "allocation", "filegroup", "data file", "log file", "transaction log"],
    priority: 1
  },
  {
    name: "Indexing & Wait Stats",
    content: part2_indexing_waits,
    keywords: ["index", "indexing", "clustered", "nonclustered", "columnstore", "wait stats", "wait type", "performance", "slow query", "execution plan", "seek", "scan", "key lookup", "missing index"],
    priority: 1
  },
  {
    name: "Concurrency & Transactions",
    content: part3_concurrency,
    keywords: ["lock", "locking", "blocking", "deadlock", "transaction", "isolation level", "concurrency", "read committed", "snapshot", "serializable", "repeatable read", "row versioning"],
    priority: 1
  },
  {
    name: "Partitioning & Compression",
    content: part4_partitioning,
    keywords: ["partition", "partitioning", "compression", "row compression", "page compression", "columnstore compression", "partition function", "partition scheme"],
    priority: 2
  },
  {
    name: "Query Store & Tuning",
    content: part5_query_store,
    keywords: ["query store", "query tuning", "plan forcing", "regression", "parameter sniffing", "statistics", "cardinality", "optimizer"],
    priority: 1
  },
  {
    name: "TempDB, Memory & I/O",
    content: part6_tempdb_memory,
    keywords: ["tempdb", "memory", "memory grant", "memory pressure", "memory dump", "buffer cache", "plan cache", "io", "disk", "read", "write", "latency", "iops"],
    priority: 1
  },
  {
    name: "Backup, Restore & HADR",
    content: part7_backup_hadr,
    keywords: ["backup", "restore", "recovery", "always on", "availability group", "failover", "replication", "log shipping", "mirroring", "hadr"],
    priority: 2
  },
  {
    name: "Security & Encryption",
    content: part8_security,
    keywords: ["security", "encryption", "tde", "transparent data encryption", "always encrypted", "permissions", "role", "login", "user", "certificate", "key"],
    priority: 2
  },
  {
    name: "Monitoring & Automation",
    content: part9_monitoring,
    keywords: ["monitoring", "automation", "agent job", "alert", "dmv", "dynamic management view", "extended events", "profiler", "trace"],
    priority: 2
  },
  {
    name: "Azure & Cloud",
    content: part10_azure,
    keywords: ["azure", "cloud", "azure sql", "managed instance", "elastic pool", "dtu", "vcore", "serverless"],
    priority: 3
  },
  {
    name: "Troubleshooting Cookbook",
    content: part11_troubleshooting,
    keywords: ["troubleshoot", "debug", "error", "issue", "problem", "fix", "resolve", "diagnose"],
    priority: 1
  },
  {
    name: "Reference Queries",
    content: part12_reference,
    keywords: ["reference", "query", "dmv query", "diagnostic query", "system query"],
    priority: 2
  }
];

/**
 * Analyzes user input and returns relevant knowledge packs
 * @param userInput The user's query/message
 * @param maxPacks Maximum number of knowledge packs to return (default: 2)
 * @param maxTokens Approximate max tokens to return (default: 8000)
 * @returns Array of relevant knowledge pack contents
 */
export function getRelevantKnowledgePacks(
  userInput: string,
  maxPacks: number = 2,
  maxTokens: number = 8000
): string[] {
  const input = userInput.toLowerCase();
  
  // Score each knowledge pack based on keyword matches
  const scored = knowledgePacks.map(pack => {
    let score = 0;
    let matchedKeywords: string[] = [];
    
    for (const keyword of pack.keywords) {
      if (input.includes(keyword)) {
        score += pack.priority;
        matchedKeywords.push(keyword);
      }
    }
    
    return { pack, score, matchedKeywords };
  });
  
  // Sort by score (descending) and take top matches
  const topMatches = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPacks);
  
  // If no matches, return empty array (use base instructions only)
  if (topMatches.length === 0) {
    return [];
  }
  
  // Build result with token budget awareness
  const results: string[] = [];
  let totalChars = 0;
  const approxCharsPerToken = 4; // Rough estimate
  const maxChars = maxTokens * approxCharsPerToken;
  
  for (const match of topMatches) {
    const packContent = match.pack.content;
    const packChars = packContent.length;
    
    if (totalChars + packChars <= maxChars) {
      results.push(`\n\n# 📚 EXPERT KNOWLEDGE: ${match.pack.name}\n${packContent}`);
      totalChars += packChars;
      console.log(`[KnowledgePack] Loaded: ${match.pack.name} (matched: ${match.matchedKeywords.join(', ')})`);
    } else {
      console.log(`[KnowledgePack] Skipped ${match.pack.name} - would exceed token budget`);
      break;
    }
  }
  
  return results;
}

/**
 * Gets knowledge packs for specific topics (manual selection)
 */
export function getKnowledgePacksByTopic(topics: string[]): string[] {
  const results: string[] = [];
  
  for (const topic of topics) {
    const pack = knowledgePacks.find(p => 
      p.name.toLowerCase().includes(topic.toLowerCase())
    );
    
    if (pack) {
      results.push(`\n\n# 📚 EXPERT KNOWLEDGE: ${pack.name}\n${pack.content}`);
      console.log(`[KnowledgePack] Loaded by topic: ${pack.name}`);
    }
  }
  
  return results;
}
