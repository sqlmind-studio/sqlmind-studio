# Chat History Feature Implementation Guide

## Files Created
1. ✅ `src/stores/chatHistory.ts` - Pinia store for managing chat sessions
2. ✅ `src/components/ChatHistory.vue` - UI component for viewing/restoring sessions

## Changes Needed in ChatInterface.vue

### 1. Add Import (after line 124)
```typescript
import ChatHistory from "@/components/ChatHistory.vue";
import { useChatHistoryStore } from "@/stores/chatHistory";
import { getConnectionInfo } from "@sqlmindstudio/plugin";
```

### 2. Add ChatHistory to components (line 136)
```typescript
components: {
  Dropdown,
  DropdownOption,
  Message,
  ToolMessage,
  Markdown,
  BaseInput,
  PromptInput,
  ChatHistory,  // ADD THIS
},
```

### 3. Add data properties (around line 160)
Find the `data()` method and add:
```typescript
data() {
  return {
    outputMode: "chat" as "chat" | "code",
    showHistory: false,  // ADD THIS
    // ... existing properties
  };
},
```

### 4. Add methods (in the methods section, around line 270)
```typescript
methods: {
  // ... existing methods ...
  
  async restoreChatSession(sessionId: string) {
    const historyStore = useChatHistoryStore();
    const session = historyStore.getSession(sessionId);
    
    if (session) {
      // Restore messages
      this.messages.splice(0, this.messages.length, ...session.messages);
      historyStore.setCurrentSession(sessionId);
      this.showHistory = false;
      
      // Scroll to bottom after restoring
      await this.$nextTick();
      this.scrollToBottom();
    }
  },
  
  async saveCurrentSession() {
    if (this.messages.length === 0) return;
    
    try {
      const connInfo = await getConnectionInfo();
      const historyStore = useChatHistoryStore();
      
      if (historyStore.currentSessionId) {
        // Update existing session
        await historyStore.updateSession(
          historyStore.currentSessionId,
          this.messages,
          connInfo.databaseName,
          connInfo.connectionType
        );
      } else {
        // Create new session
        const sessionId = await historyStore.createSession(
          this.messages,
          connInfo.databaseName,
          connInfo.connectionType
        );
      }
    } catch (error) {
      console.error("Failed to save chat session:", error);
    }
  },
},
```

### 5. Add watchers (after methods section)
```typescript
watch: {
  messages: {
    handler() {
      // Auto-save after each message change (debounced)
      if (this.saveSessionDebounced) {
        this.saveSessionDebounced();
      }
    },
    deep: true,
  },
},
```

### 6. Add mounted hook (or update existing one)
```typescript
async mounted() {
  // ... existing mounted code ...
  
  // Load chat history
  const historyStore = useChatHistoryStore();
  await historyStore.loadSessions();
  
  // Create debounced save function
  this.saveSessionDebounced = _.debounce(this.saveCurrentSession, 2000);
  
  // ... rest of mounted code ...
},
```

### 7. Add CSS for history sidebar (in the <style> section)
```css
.header-actions {
  display: flex;
  gap: 8px;
}

.history-btn {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 350px;
  height: 100%;
  background: var(--bg-color, #fff);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
```

## How It Works

### Auto-Save
- Chat sessions are automatically saved 2 seconds after any message change
- Uses debouncing to avoid excessive saves
- Saves to SQLMind Studio's plugin storage

### Session Management
- Each session has:
  - Unique ID
  - Title (from first user message)
  - Timestamp
  - All messages
  - Database name and type
- Sessions are grouped by date
- Maximum 50 sessions kept (oldest deleted automatically)

### UI Features
- **History Button**: Opens sidebar with all saved sessions
- **Date Grouping**: Sessions organized by date (Today, Yesterday, etc.)
- **Session Info**: Shows time, database, and message count
- **Restore**: Click any session to restore it
- **Delete**: Delete individual sessions
- **Clear All**: Clear entire history

## Testing
1. Rebuild plugin: `yarn build && Copy-Item manifest.json dist\`
2. Restart SQLMind Studio
3. Have a conversation with AI
4. Click History button - should see saved session
5. Start new conversation, then restore old one
6. Sessions should persist across app restarts

## Storage
- Uses SQLMind Studio's `getData/setData` API
- Storage key: `chat_history_sessions`
- Data persists in plugin storage (survives app restarts)
