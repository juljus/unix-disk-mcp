# macOS SSD MCP Server - Design Document

## Overview

An MCP server that gives AI agents exploratory access to a macOS filesystem to identify unused, forgotten, or unnecessary files and applications. The AI suggests what to delete, but **cannot delete anything itself** — deletion is a manual user action.

## Philosophy

Traditional disk cleaners run predefined rules. This tool lets an LLM *reason* about what's likely unused:

- "You have 3 different Node versions installed via different methods"
- "This 40GB VM hasn't been opened in 14 months"
- "Docker images exist for a project folder that no longer exists"
- "Homebrew has packages that nothing seems to use"

The AI explores, understands context, and makes intelligent suggestions.

---

## Workflow

| Step | Actor | Action |
|------|-------|--------|
| 1 | AI | Explores filesystem, analyzes disk usage |
| 2 | AI | Suggests items to delete with reasoning |
| 3 | User | Reviews and approves/rejects suggestions |
| 4 | AI | Stages approved items for deletion |
| 5 | User | Manually runs deletion command (outside AI's reach) |

**Key security property:** The AI has no delete capability. Deletion is architecturally separated.

---

## MCP Tools

Minimal set — the AI's value is in *reasoning* about what it finds, not having specialized tools for everything. We can add more later.

### Exploration (General Purpose)

#### `list_directory`
List contents of a directory.
- **Input:** `path`, `show_hidden` (optional, default false)
- **Output:** Array of items, each with:
  - `name`
  - `type` ("file" | "directory")
  - `size` (bytes, for files only — folder sizes are expensive)
  - `modified` (ISO timestamp)
  - `accessed` (ISO timestamp, may be unreliable)

#### `get_disk_usage`
Overview of disk space.
- **Input:** None
- **Output:**
  - `total` (bytes)
  - `used` (bytes)
  - `available` (bytes)
  - `breakdown` - array of top-level folders in home dir with sizes

#### `find_large_items`
Find files/folders above a size threshold.
- **Input:** `path`, `min_size_mb`, `max_results` (optional, default 20)
- **Output:** Array of items sorted by size descending, each with path and size

#### `get_item_info`
Detailed info about a single path.
- **Input:** `path`
- **Output:**
  - `type` ("file" | "directory")
  - `size` (bytes, calculated recursively for directories)
  - `modified` (ISO timestamp)
  - `accessed` (ISO timestamp)
  - `created` (ISO timestamp)

### Specialized Discovery

#### `list_applications`
List installed applications with usage info (uses Spotlight).
- **Input:** None
- **Output:** Array of apps, each with:
  - `name`
  - `path`
  - `size` (bytes)
  - `last_opened` (ISO timestamp, may be null)

#### `list_homebrew`
List Homebrew packages (if Homebrew is installed).
- **Input:** `include_casks` (optional, default true)
- **Output:** Array of packages, each with:
  - `name`
  - `type` ("formula" | "cask")
  - `version`
  - `installed_size` (bytes, if available)

#### `list_docker`
List Docker resources (if Docker is installed/running).
- **Input:** `resource_type` (optional: "images" | "containers" | "volumes" | "all", default "all")
- **Output:** Object with arrays for each resource type, including size and last used info

### Staging

#### `stage_for_deletion`
Add a path to the staged deletion list.
- **Input:** `path`, `reason` (optional, AI's explanation)
- **Output:** Confirmation with updated staged count
- **Behavior:** Refuses if path is in `protected_paths`

#### `unstage`
Remove a path from the staged list.
- **Input:** `path`
- **Output:** Confirmation with updated staged count

#### `get_staged`
View all currently staged items.
- **Input:** None
- **Output:** Array of staged items, each with:
  - `path`
  - `size` (bytes)
  - `reason` (if provided)
  - `staged_at` (ISO timestamp)
- Also includes `total_size` summary

---

## Deletion (Manual Only)

A separate CLI script that is **not** an MCP tool:

```bash
./delete-staged.sh
# or
npm run delete
```

This script:
1. Reads the staged list
2. Shows what will be deleted with total size
3. Asks for confirmation
4. Moves items to Trash (or permanently deletes, based on config)
5. Logs what was deleted

---

## Configuration

Two files:
- `config.sample.json` - Tracked in git, shows defaults and structure
- `config.json` - Gitignored, user's actual settings

### Config Structure

```json
{
  "protected_paths": [
    "/System",
    "/Applications", 
    "~/.ssh",
    "~/.gnupg",
    "~/Documents",
    "~/.zshrc",
    "~/.config"
  ],
  
  "scan_locations": [
    "~",
    "/Library",
    "/opt",
    "/usr/local"
  ],
  
  "ignore_patterns": [
    ".git"
  ],
  
  "require_confirmation": true,
  
  "max_delete_size_gb": 10,
  
  "use_trash": true,
  
  "dry_run": false
}
```

### Config Behavior
- `protected_paths` - AI cannot stage these for deletion (blacklist approach)
- `scan_locations` - Where the AI is encouraged to look
- `ignore_patterns` - Patterns to skip during exploration
- `max_delete_size_gb` - Safety limit for single deletion batch
- `use_trash` - Move to Trash instead of permanent delete
- `dry_run` - When true, delete script only reports what *would* happen

### First Run
If `config.json` doesn't exist, the server refuses to start and instructs the user to copy from `config.sample.json`.

---

## Data Storage

Location: `./data/` (in project folder)

- `staged.json` - Current staged deletion list
- `history.json` - Log of past deletions

---

## Tech Stack

- **Language:** TypeScript
- **MCP SDK:** @modelcontextprotocol/sdk
- **Runtime:** Node.js
- **Delete script:** Bash (simple, transparent, no build step)

---

## Project Structure

```
macos-ssd-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server setup, tool registration
│   ├── config/
│   │   └── index.ts          # Config loading & validation
│   ├── tools/
│   │   ├── exploration.ts    # list_directory, get_disk_usage, find_large_items, get_item_info
│   │   ├── discovery.ts      # list_applications, list_homebrew, list_docker
│   │   └── staging.ts        # stage_for_deletion, unstage, get_staged
│   └── utils/
│       └── fs.ts             # Shared filesystem helpers
├── scripts/
│   └── delete-staged.sh      # Manual deletion script (NOT an MCP tool)
├── data/
│   ├── staged.json           # Staged items (gitignored)
│   └── history.json          # Deletion history (gitignored)
├── config.sample.json        # Example config (tracked)
├── config.json               # User config (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Error Handling

Errors are returned as tool results so the AI can see and react to them:

```typescript
// Example tool response on error
{
  "success": false,
  "error": "Path not found: /Users/foo/bar",
  "code": "PATH_NOT_FOUND"
}

// Example tool response on success
{
  "success": true,
  "data": { ... }
}
```

The AI sees errors and can:
- Try a different path
- Inform the user
- Adjust its approach

## Running the Server

**Development:**
```bash
npm run dev
# runs: npx ts-node src/index.ts
```

**Production:**
```bash
npm run build   # compiles to dist/
npm start       # runs: node dist/index.js
```

**Future (npm publish):**
```bash
npx macos-ssd-mcp
```

---

## Open Questions

- [ ] What other discovery tools might be useful? (VMs, iOS backups, etc.)
- [ ] Expiry on staged items? (Auto-unstage after X days if not deleted)
