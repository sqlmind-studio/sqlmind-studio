<template>
  <div class="tab-statistics">
    <div class="statistics-header" v-if="!embedded">
      <h2>Statistics Parser</h2>
      <p class="description">
        Paste SQL Server Statistics IO and Time output to parse and visualize the data.
      </p>
    </div>
    
    <div class="statistics-input-section" v-if="!embedded">
      <textarea
        v-model="statsText"
        class="statistics-textarea"
        placeholder="Paste Statistics IO and/or Statistics Time output here...

Example:
Table 'Users'. Scan count 5, logical reads 42015, physical reads 1, read-ahead reads 41306, lob logical reads 0, lob physical reads 0, lob read-ahead reads 0.
SQL Server Execution Times: CPU time = 156527 ms, elapsed time = 284906 ms."
        rows="10"
      ></textarea>
      <div class="statistics-actions">
        <button class="btn btn-primary" @click="parseStatistics" :disabled="!statsText.trim()">
          <i class="material-icons">analytics</i>
          Parse Statistics
        </button>
        <button class="btn btn-default" @click="clearStatistics">
          <i class="material-icons">clear</i>
          Clear
        </button>
      </div>
    </div>
    
    <div v-if="displayedData" class="statistics-results">
      <!-- Individual Query Results -->
      <div v-for="(query, qIndex) in displayedData.queries" :key="qIndex" class="query-section">
        <h2 class="query-title">Query {{ qIndex + 1 }}</h2>
        
        <div v-if="query.compileTime" class="stats-section">
          <h3>SQL Server parse and compile time:</h3>
          <table class="stats-table time-table">
            <thead>
              <tr>
                <th>CPU</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ formatTime(query.compileTime.cpu) }}</td>
                <td>{{ formatTime(query.compileTime.elapsed) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div v-if="query.rowsAffected" class="stats-section">
          <div class="rows-affected">
            <strong>{{ formatNumber(query.rowsAffected) }}</strong> rows affected
          </div>
        </div>
        
        <div v-if="query.ioStats && query.ioStats.length > 0" class="stats-section">
          <div class="table-scroll">
            <table class="stats-table io-table">
              <thead>
                <tr>
                  <th>Row Num</th>
                  <th>Table</th>
                  <th>Scan Count</th>
                  <th>Logical Reads</th>
                  <th>Physical Reads</th>
                  <th>Read-Ahead Reads</th>
                  <th>LOB Logical Reads</th>
                  <th>LOB Physical Reads</th>
                  <th>LOB Read-Ahead Reads</th>
                  <th>% Logical Reads of Total Reads</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(stat, index) in query.ioStats" :key="index">
                  <td class="number">{{ index + 1 }}</td>
                  <td class="table-name">{{ stat.table }}</td>
                  <td class="number">{{ formatNumber(stat.scanCount) }}</td>
                  <td class="number">{{ formatNumber(stat.logicalReads) }}</td>
                  <td class="number">{{ formatNumber(stat.physicalReads) }}</td>
                  <td class="number">{{ formatNumber(stat.readAheadReads) }}</td>
                  <td class="number">{{ formatNumber(stat.lobLogical) }}</td>
                  <td class="number">{{ formatNumber(stat.lobPhysical) }}</td>
                  <td class="number">{{ formatNumber(stat.lobReadAhead) }}</td>
                  <td class="number">{{ calculatePercentage(stat.logicalReads, query.ioStats) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td></td>
                  <td><strong>Total</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'scanCount')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'logicalReads')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'physicalReads')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'readAheadReads')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'lobLogical')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'lobPhysical')) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(sumField(query.ioStats, 'lobReadAhead')) }}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        <div v-if="query.executionTime" class="stats-section">
          <h3>SQL Server Execution Times:</h3>
          <table class="stats-table time-table">
            <thead>
              <tr>
                <th>CPU</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ formatTime(query.executionTime.cpu) }}</td>
                <td>{{ formatTime(query.executionTime.elapsed) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div v-if="query.errors && query.errors.length > 0" class="stats-section">
          <div class="error-messages">
            <div v-for="(error, eIndex) in query.errors" :key="eIndex" class="error-message">
              <i class="material-icons">error</i>
              <pre>{{ error }}</pre>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Grand Totals Section -->
      <div v-if="displayedData.queries.length > 1" class="totals-section">
        <h2 class="totals-title">Totals:</h2>
        
        <div class="stats-section">
          <div class="table-scroll">
            <table class="stats-table io-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Scan Count</th>
                  <th>Logical Reads</th>
                  <th>Physical Reads</th>
                  <th>Read-Ahead Reads</th>
                  <th>LOB Logical Reads</th>
                  <th>LOB Physical Reads</th>
                  <th>LOB Read-Ahead Reads</th>
                  <th>% Logical Reads of Total Reads</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(stat, index) in displayedData.totalTables" :key="index">
                  <td class="table-name">{{ stat.table }}</td>
                  <td class="number">{{ formatNumber(stat.scanCount) }}</td>
                  <td class="number">{{ formatNumber(stat.logicalReads) }}</td>
                  <td class="number">{{ formatNumber(stat.physicalReads) }}</td>
                  <td class="number">{{ formatNumber(stat.readAheadReads) }}</td>
                  <td class="number">{{ formatNumber(stat.lobLogical) }}</td>
                  <td class="number">{{ formatNumber(stat.lobPhysical) }}</td>
                  <td class="number">{{ formatNumber(stat.lobReadAhead) }}</td>
                  <td class="number">{{ calculatePercentage(stat.logicalReads, displayedData.totalTables) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td><strong>Total</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.scanCount) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.logicalReads) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.physicalReads) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.readAheadReads) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.lobLogical) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.lobPhysical) }}</strong></td>
                  <td class="number"><strong>{{ formatNumber(displayedData.grandTotals.lobReadAhead) }}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        <div class="stats-section">
          <table class="stats-table time-table">
            <thead>
              <tr>
                <th></th>
                <th>CPU</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>SQL Server parse and compile time:</strong></td>
                <td>{{ formatTime(displayedData.totalCompileTime.cpu) }}</td>
                <td>{{ formatTime(displayedData.totalCompileTime.elapsed) }}</td>
              </tr>
              <tr>
                <td><strong>SQL Server Execution Times:</strong></td>
                <td>{{ formatTime(displayedData.totalExecutionTime.cpu) }}</td>
                <td>{{ formatTime(displayedData.totalExecutionTime.elapsed) }}</td>
              </tr>
              <tr class="totals-row">
                <td><strong>Total</strong></td>
                <td><strong>{{ formatTime(displayedData.totalCompileTime.cpu + displayedData.totalExecutionTime.cpu) }}</strong></td>
                <td><strong>{{ formatTime(displayedData.totalCompileTime.elapsed + displayedData.totalExecutionTime.elapsed) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    
    <div v-if="error" class="statistics-error">
      <i class="material-icons">error</i>
      {{ error }}
    </div>
    
    <!-- Only show StatusBar in standalone viewer, not when embedded in query editor -->
    <status-bar v-if="!embedded" :active="active">
      <div class="statusbar-info col flex expand">
        <span class="statusbar-item">
          <i class="material-icons">analytics</i>
          <span>Statistics Parser</span>
        </span>
      </div>
    </status-bar>
  </div>
</template>

<script>
import Vue from 'vue'
import StatusBar from './common/StatusBar.vue'

export default Vue.extend({
  name: 'TabStatistics',
  components: {
    StatusBar
  },
  props: {
    tab: Object,
    active: Boolean,
    connection: Object,
    embedded: Boolean,
    selectedResult: Number
  },
  data() {
    return {
      statsText: '',
      parsedData: null,
      error: null
    }
  },
  mounted() {
    // If initial data was provided
    if (this.tab && this.tab.statsData) {
      this.statsText = this.tab.statsData
      this.parseStatistics()
    }
  },
  computed: {
    // Filter queries to show only the selected result's statistics
    displayedQueries() {
      if (!this.parsedData || !this.parsedData.queries) return []
      
      // In embedded mode with a selected result, show only that query's statistics
      if (this.embedded && this.selectedResult !== undefined && this.selectedResult !== null) {
        const query = this.parsedData.queries[this.selectedResult]
        return query ? [query] : []
      }
      
      // Otherwise show all queries
      return this.parsedData.queries
    },
    // Adjust displayed data to show only selected query or all queries
    displayedData() {
      if (!this.parsedData) return null
      
      // In embedded mode with a selected result, show only that query's statistics
      if (this.embedded && this.selectedResult !== undefined && this.selectedResult !== null) {
        const query = this.parsedData.queries[this.selectedResult]
        if (!query) return null
        
        return {
          queries: [query],
          totalCompileTime: query.compileTime || { cpu: 0, elapsed: 0 },
          totalExecutionTime: query.executionTime || { cpu: 0, elapsed: 0 },
          totalIoStats: query.ioStats || []
        }
      }
      
      // Otherwise return all data
      return this.parsedData
    }
  },
  watch: {
    'tab.statsData'(val) {
      if (val && typeof val === 'string') {
        this.statsText = val
        this.parseStatistics()
      }
    }
  },
  methods: {
    parseStatistics() {
      this.error = null
      this.parsedData = null
      
      if (!this.statsText.trim()) {
        if (this.embedded) {
          // In embedded mode, quietly do nothing when there is no stats text
          return
        } else {
          this.error = 'Please paste statistics output first'
          return
        }
      }
      
      try {
        const queries = []
        let currentQuery = {
          ioStats: [],
          compileTime: null,
          executionTime: null,
          rowsAffected: null,
          errors: []
        }
        let hasSeenExecutionTimeForCurrentQuery = false
        let lastLineWasExecutionTime = false
        let consecutiveExecutionTimeCount = 0
        const seenLogicalReads = new Set() // Track logical reads to detect duplicates
        
        // Join lines and then split by double newlines or specific patterns to handle multi-line entries
        const text = this.statsText.replace(/\r\n/g, '\n') // Normalize line endings
        const lines = text.split('\n')
        
        console.log('=== Starting parse, total lines:', lines.length)
        
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim()
          
          // Skip empty lines, but track consecutive empty lines as potential query boundaries
          if (!line) {
            // Check if we have multiple consecutive empty lines (query boundary)
            let emptyCount = 1
            while (i + emptyCount < lines.length && !lines[i + emptyCount].trim()) {
              emptyCount++
            }
            
            // If we have 2+ empty lines and current query has data, save it and start new
            if (emptyCount >= 2 && (currentQuery.ioStats.length > 0 || currentQuery.executionTime)) {
              console.log('>>> Found query boundary (empty lines), saving query with', currentQuery.ioStats.length, 'tables')
              queries.push(currentQuery)
              currentQuery = {
                ioStats: [],
                compileTime: null,
                executionTime: null,
                rowsAffected: null,
                errors: []
              }
              seenLogicalReads.clear() // Reset for next query
            }
            continue
          }
          
          // Check if this line starts with "SQL Server parse and compile time:"
          // The actual time values might be on the next line
          if (line.match(/^SQL Server parse and compile time:/i)) {
            // Look at the next line for the actual values
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ''
            const compileMatch = nextLine.match(/CPU time = (\d+) ms.*elapsed time = (\d+) ms/i)
            
            if (compileMatch) {
              console.log(`Line ${i}-${i+1}: Found compile time:`, compileMatch[1], 'ms, currentQuery.executionTime=', currentQuery.executionTime)
              // If we have execution time from previous query, save it and start new
              if (currentQuery.executionTime || currentQuery.ioStats.length > 0) {
                console.log('>>> Saving query with', currentQuery.ioStats.length, 'tables')
                queries.push(currentQuery)
                currentQuery = {
                  ioStats: [],
                  compileTime: null,
                  executionTime: null,
                  rowsAffected: null,
                  errors: []
                }
                seenLogicalReads.clear() // Reset for next query
              }
              currentQuery.compileTime = {
                cpu: parseInt(compileMatch[1]),
                elapsed: parseInt(compileMatch[2])
              }
              i++ // Skip the next line since we already processed it
              continue
            }
          }
          
          // Parse rows affected
          const rowsMatch = line.match(/\((\d+) row\(s\) affected\)/i)
          if (rowsMatch) {
            currentQuery.rowsAffected = parseInt(rowsMatch[1])
            continue
          }
          
          // Parse IO statistics
          const ioMatch = line.match(/Table '([^']+)'.*Scan count (\d+).*logical reads (\d+).*physical reads (\d+).*read-ahead reads (\d+).*lob logical reads (\d+).*lob physical reads (\d+).*lob read-ahead reads (\d+)/i)
          if (ioMatch) {
            const tableName = ioMatch[1]
            const logicalReads = parseInt(ioMatch[3])
            console.log(`Line ${i}: Found Table '${tableName}', hasSeenExecTime=${hasSeenExecutionTimeForCurrentQuery}, lastLineWasExecTime=${lastLineWasExecutionTime}, consecutiveExecCount=${consecutiveExecutionTimeCount}, currentTables=${currentQuery.ioStats.length}`)
            
            // Check if this is a duplicate (SQL Server outputs statistics twice for each query)
            if (seenLogicalReads.has(logicalReads)) {
              console.log(`>>> Skipping duplicate table stats with Logical Reads: ${logicalReads}`)
              lastLineWasExecutionTime = false
              consecutiveExecutionTimeCount = 0
              continue
            }
            
            // Only start a new query if we've seen execution time for the previous query
            // and the last line was an execution time (indicating query is complete)
            if (hasSeenExecutionTimeForCurrentQuery && lastLineWasExecutionTime && currentQuery.ioStats.length > 0) {
              console.log('>>> Found new Table after execution time, starting new query. Previous query had', currentQuery.ioStats.length, 'tables')
              queries.push(currentQuery)
              currentQuery = {
                ioStats: [],
                compileTime: null,
                executionTime: null,
                rowsAffected: null,
                errors: []
              }
              hasSeenExecutionTimeForCurrentQuery = false
              consecutiveExecutionTimeCount = 0
              seenLogicalReads.clear() // Reset for next query
            }
            
            const tableStats = {
              table: tableName,
              scanCount: parseInt(ioMatch[2]),
              logicalReads: logicalReads,
              physicalReads: parseInt(ioMatch[4]),
              readAheadReads: parseInt(ioMatch[5]),
              lobLogical: parseInt(ioMatch[6]),
              lobPhysical: parseInt(ioMatch[7]),
              lobReadAhead: parseInt(ioMatch[8])
            }
            console.log(`Adding table stats: ${tableName}, Logical Reads: ${tableStats.logicalReads}`)
            seenLogicalReads.add(logicalReads)
            currentQuery.ioStats.push(tableStats)
            lastLineWasExecutionTime = false
            consecutiveExecutionTimeCount = 0
            continue
          }
          
          // Check if this line starts with "SQL Server Execution Times:"
          // The actual time values might be on the next line
          if (line.match(/^SQL Server Execution Times:/i)) {
            // Look at the next line for the actual values
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ''
            const execMatch = nextLine.match(/CPU time = (\d+) ms.*elapsed time = (\d+) ms/i)
            
            if (execMatch) {
              // Check if this is actually a compile time (appears after we already have execution time and table stats)
              // Compile times appear AFTER the first execution time and table stats, signaling a new query
              const isCompileTime = hasSeenExecutionTimeForCurrentQuery && currentQuery.ioStats.length > 0
              
              if (isCompileTime) {
                console.log(`Line ${i}-${i+1}: Found compile time (new query boundary):`, execMatch[1], 'ms')
                // Save current query and start new one
                queries.push(currentQuery)
                currentQuery = {
                  ioStats: [],
                  compileTime: {
                    cpu: parseInt(execMatch[1]),
                    elapsed: parseInt(execMatch[2])
                  },
                  executionTime: null,
                  rowsAffected: null,
                  errors: []
                }
                hasSeenExecutionTimeForCurrentQuery = false
                lastLineWasExecutionTime = false
                consecutiveExecutionTimeCount = 0
                seenLogicalReads.clear() // Reset for next query
              } else {
                console.log(`Line ${i}-${i+1}: Found execution time:`, execMatch[1], 'ms')
                // Accumulate execution times (SQL Server outputs multiple execution time messages per query)
                if (!currentQuery.executionTime) {
                  currentQuery.executionTime = {
                    cpu: parseInt(execMatch[1]),
                    elapsed: parseInt(execMatch[2])
                  }
                } else {
                  // Add to existing times
                  currentQuery.executionTime.cpu += parseInt(execMatch[1])
                  currentQuery.executionTime.elapsed += parseInt(execMatch[2])
                }
                hasSeenExecutionTimeForCurrentQuery = true
                
                // Increment consecutive execution time counter if last line was also execution time
                if (lastLineWasExecutionTime) {
                  consecutiveExecutionTimeCount++
                } else {
                  consecutiveExecutionTimeCount = 1
                }
                
                lastLineWasExecutionTime = true
                console.log('Set execution time, tables so far:', currentQuery.ioStats.length)
              }
              i++ // Skip the next line since we already processed it
              continue
            }
          }
          
          // Parse errors
          const errorMatch = line.match(/Msg (\d+), Level (\d+), State (\d+), Line (\d+)/i)
          if (errorMatch) {
            const errorMsg = line
            currentQuery.errors.push(errorMsg)
            continue
          } else if (currentQuery.errors.length > 0 && line.trim() && !line.includes('SQL Server')) {
            // Continuation of error message
            currentQuery.errors[currentQuery.errors.length - 1] += '\n' + line.trim()
          }
        }
        
        // Add the last query (only if it has meaningful data - tables or rows affected)
        if (currentQuery.ioStats.length > 0 || currentQuery.rowsAffected) {
          console.log('Adding final query with', currentQuery.ioStats.length, 'tables')
          queries.push(currentQuery)
        } else if (currentQuery.errors.length > 0) {
          // If we only have errors with no data, attach them to the previous query
          if (queries.length > 0) {
            queries[queries.length - 1].errors.push(...currentQuery.errors)
            console.log('Attached errors to previous query')
          }
        }
        
        console.log('Total queries parsed:', queries.length)
        queries.forEach((q, i) => {
          console.log(`Query ${i + 1}:`, q.ioStats.length, 'tables,', q.rowsAffected, 'rows')
          q.ioStats.forEach((stat, j) => {
            console.log(`  Table ${j + 1}: ${stat.table}, Logical Reads: ${stat.logicalReads}`)
          })
        })
        
        if (queries.length === 0) {
          this.error = 'No valid statistics data found. Please check the format.'
          return
        }
        
        // Calculate totals across all queries
        const allTables = {}
        let totalCompileCpu = 0
        let totalCompileElapsed = 0
        let totalExecCpu = 0
        let totalExecElapsed = 0
        
        queries.forEach(query => {
          if (query.compileTime) {
            totalCompileCpu += query.compileTime.cpu
            totalCompileElapsed += query.compileTime.elapsed
          }
          if (query.executionTime) {
            totalExecCpu += query.executionTime.cpu
            totalExecElapsed += query.executionTime.elapsed
          }
          
          query.ioStats.forEach(stat => {
            if (!allTables[stat.table]) {
              allTables[stat.table] = {
                table: stat.table,
                scanCount: 0,
                logicalReads: 0,
                physicalReads: 0,
                readAheadReads: 0,
                lobLogical: 0,
                lobPhysical: 0,
                lobReadAhead: 0
              }
            }
            allTables[stat.table].scanCount += stat.scanCount
            allTables[stat.table].logicalReads += stat.logicalReads
            allTables[stat.table].physicalReads += stat.physicalReads
            allTables[stat.table].readAheadReads += stat.readAheadReads
            allTables[stat.table].lobLogical += stat.lobLogical
            allTables[stat.table].lobPhysical += stat.lobPhysical
            allTables[stat.table].lobReadAhead += stat.lobReadAhead
          })
        })
        
        const totalTables = Object.values(allTables)
        const grandTotals = {
          scanCount: totalTables.reduce((sum, stat) => sum + stat.scanCount, 0),
          logicalReads: totalTables.reduce((sum, stat) => sum + stat.logicalReads, 0),
          physicalReads: totalTables.reduce((sum, stat) => sum + stat.physicalReads, 0),
          readAheadReads: totalTables.reduce((sum, stat) => sum + stat.readAheadReads, 0),
          lobLogical: totalTables.reduce((sum, stat) => sum + stat.lobLogical, 0),
          lobPhysical: totalTables.reduce((sum, stat) => sum + stat.lobPhysical, 0),
          lobReadAhead: totalTables.reduce((sum, stat) => sum + stat.lobReadAhead, 0)
        }
        
        this.parsedData = {
          queries,
          totalTables,
          grandTotals,
          totalCompileTime: { cpu: totalCompileCpu, elapsed: totalCompileElapsed },
          totalExecutionTime: { cpu: totalExecCpu, elapsed: totalExecElapsed }
        }
      } catch (ex) {
        this.error = `Error parsing statistics: ${ex.message}`
      }
    },
    clearStatistics() {
      this.statsText = ''
      this.parsedData = null
      this.error = null
    },
    formatNumber(num) {
      if (num === null || num === undefined) return '0'
      return num.toLocaleString()
    },
    formatTime(ms) {
      if (ms === null || ms === undefined) return '00:00:00.000'
      const hours = Math.floor(ms / 3600000)
      const minutes = Math.floor((ms % 3600000) / 60000)
      const seconds = Math.floor((ms % 60000) / 1000)
      const milliseconds = ms % 1000
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
    },
    sumField(stats, field) {
      return stats.reduce((sum, stat) => sum + stat[field], 0)
    },
    calculatePercentage(value, allStats) {
      const total = this.sumField(allStats, 'logicalReads')
      if (total === 0) return '0.000'
      return ((value / total) * 100).toFixed(3)
    }
  }
})
</script>

<style scoped>
.tab-statistics {
  padding: 16px 16px 2.6rem; /* Add bottom padding for status bar */
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable; /* keep right gutter reserved */
  overscroll-behavior: contain;
  background: var(--theme-bg);
}

.statistics-header {
  margin-bottom: 20px;
}

.statistics-header h2 {
  margin: 0 0 8px 0;
  color: var(--theme-base);
  font-size: 24px;
}

.statistics-header .description {
  margin: 0;
  color: var(--theme-muted);
  font-size: 14px;
}

/* Statistics Input Section */
.statistics-input-section {
  margin-bottom: 30px;
}

.statistics-textarea {
  width: 100%;
  min-height: 150px;
  padding: 12px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  background: var(--query-editor-bg);
  color: var(--theme-base);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  resize: vertical;
  margin-bottom: 12px;
}

.statistics-textarea:focus {
  outline: none;
  border-color: var(--theme-primary);
}

.statistics-actions {
  display: flex;
  gap: 10px;
}

.statistics-actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.statistics-actions .btn-primary {
  background: var(--theme-primary);
  color: white;
  border: none;
}

.statistics-actions .btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.statistics-actions .btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.statistics-actions .btn-default {
  background: var(--theme-bg-hover);
  color: var(--theme-base);
  border: 1px solid var(--theme-border);
}

.statistics-actions .btn-default:hover {
  background: var(--theme-bg-alt);
}

.statistics-results {
  margin-top: 20px;
  padding-bottom: 0; /* no extra white at the end */
}

.stats-section {
  margin-bottom: 30px;
  background: var(--query-editor-bg);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  padding: 20px;
}

.stats-section:last-child {
  margin-bottom: 0; /* tighten bottom spacing */
}

.stats-section h3 {
  margin: 0 0 15px 0;
  color: var(--theme-base);
  font-size: 18px;
  font-weight: 600;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
}

.stats-table thead {
  background: var(--theme-bg-hover);
}

.stats-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  color: var(--theme-base);
  border-bottom: 2px solid var(--theme-border);
}

.stats-table td {
  padding: 10px 12px;
  color: var(--theme-base);
  border-bottom: 1px solid var(--theme-border);
}

.stats-table .number {
  text-align: right;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.stats-table .table-name {
  font-weight: 500;
}

.stats-table tbody tr:hover {
  background: var(--theme-bg-hover);
}

.stats-table tfoot .totals-row {
  background: var(--theme-bg-alt);
  border-top: 2px solid var(--theme-border);
}

.stats-table tfoot td {
  border-bottom: none;
  padding: 12px;
}

.table-scroll {
  overflow-x: auto;
}

.io-table {
  min-width: 800px;
}

.rows-affected {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  color: var(--theme-success, #22c55e);
}

.rows-affected .material-icons {
  font-size: 24px;
}

.statistics-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px;
  background: var(--theme-error-bg, #fee);
  color: var(--theme-error-color, #c00);
  border-radius: 4px;
  border: 1px solid var(--theme-error-border, #fcc);
  margin-top: 20px;
  white-space: pre-line;
  line-height: 1.6;
}

.statistics-error .material-icons {
  font-size: 20px;
  flex-shrink: 0;
}

.query-section {
  margin-bottom: 40px;
  padding-bottom: 30px;
  border-bottom: 2px solid var(--theme-border);
}

.query-section:last-child {
  border-bottom: none;
  margin-bottom: 0; /* remove extra space at the end */
  padding-bottom: 0; /* remove extra space at the end */
}

.query-title {
  margin: 0 0 20px 0;
  color: var(--theme-primary);
  font-size: 20px;
  font-weight: 600;
}

.totals-section {
  margin-top: 40px;
  padding-top: 30px;
  border-top: 3px solid var(--theme-primary);
}

.totals-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
}

.totals-title {
  margin: 0 0 20px 0;
  color: var(--theme-primary);
  font-size: 22px;
  font-weight: 700;
}

.time-table {
  max-width: 400px;
}

.time-table th:first-child,
.time-table td:first-child {
  text-align: left;
  min-width: 250px;
}

.error-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.error-message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: var(--theme-error-bg, rgba(239, 68, 68, 0.1));
  color: var(--theme-error, #ef4444);
  border: 1px solid var(--theme-error, #ef4444);
  border-radius: 4px;
}

.error-message .material-icons {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.error-message pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.io-table {
  min-width: 1000px;
}
</style>
