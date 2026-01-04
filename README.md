# macOS SSD MCP

An MCP server that gives AI agents exploratory access to your macOS filesystem to identify unused files, forgotten applications, and space-consuming cruft. The AI suggests what to delete, but **cannot delete anything itself** — deletion is always a manual user action.

## Philosophy

Traditional disk cleaners run predefined rules. This tool lets an LLM *reason* about what's likely unused:

- "You have 3 different Node versions installed via different methods"
- "This 40GB VM hasn't been opened in 14 months"  
- "Docker images exist for a project directory that no longer exists"
- "Homebrew has packages that nothing seems to use"

The AI explores, understands context, and makes intelligent suggestions. You make the final call.

## Security Model

**Critical:** The AI has no delete capability. This is architectural, not just a safety check.

- ✅ AI can explore your filesystem
- ✅ AI can suggest items to delete
- ✅ AI can stage items for deletion
- ❌ AI **cannot** delete anything
- ❌ AI **cannot** execute the delete script

Deletion happens via a separate bash script that you run manually: `./scripts/delete-staged.sh`

## Installation

### Prerequisites

- macOS
- Node.js 20+
- Claude Desktop (or another MCP client)

### Setup

1. **Clone and install:**
   ```bash
   git clone <repository-url>
   cd macos-ssd-mcp
   npm install
   ```

2. **Create config:**
   ```bash
   cp config.sample.json config.json
   ```

3. **Edit config.json:**
   ```json
   {
     "protected_paths": [
       "/System",
       "/Applications",
       "~/.ssh",
       "~/.gnupg",
       "~/Documents",
       "~/Desktop"
     ],
     "scan_locations": ["~", "/Library", "/opt", "/usr/local"],
     "ignore_patterns": [".git"],
     "max_delete_size_gb": 10,
     "dry_run": false
   }
   ```

   **Important:** Adjust `protected_paths` for your setup. Paths are recursive — protecting `~/Documents` protects everything inside it.

4. **Add to Claude Desktop:**

   Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "macos-ssd-mcp": {
         "command": "node",
         "args": ["/absolute/path/to/macos-ssd-mcp/dist/index.js"]
       }
     }
   }
   ```

   Or for development:
   ```json
   {
     "mcpServers": {
       "macos-ssd-mcp": {
         "command": "npx",
         "args": ["-y", "tsx", "/absolute/path/to/macos-ssd-mcp/src/index.ts"]
       }
     }
   }
   ```

5. **Build (for production):**
   ```bash
   npm run build
   ```

6. **Restart Claude Desktop**

## Usage

### 1. Ask the AI to explore

Example prompts:
- "What's taking up space on my disk?"
- "Find large files I probably don't need"
- "Check for old Docker images and unused Homebrew packages"
- "Look for VMs or downloads I haven't used in months"

### 2. Review suggestions

The AI will suggest items with reasoning:
```
I found these items you might not need:

1. ~/Library/Caches/com.old-app (2.3 GB)
   - Cache from an app that's no longer installed
   
2. ~/Downloads/installer.dmg (1.1 GB)
   - Installer from 8 months ago
   
3. ~/Parallels/old-vm.pvm (40 GB)
   - VM last opened 14 months ago
```

### 3. Stage items for deletion

Tell the AI what to stage:
- "Stage items 1 and 3"
- "Stage the VM and the installer"
- "Stage everything except the cache"

The AI uses the `stage_for_deletion` tool. Items go to `data/staged.json`.

### 4. Review staged items

```bash
npm run delete
```

This shows what will be deleted and asks for confirmation:

```
=== Staged Items ===

  /Users/you/Parallels/old-vm.pvm (40.0GB)
    Reason: VM last opened 14 months ago

  /Users/you/Downloads/installer.dmg (1.1GB)
    Reason: Installer from 8 months ago

=== Summary ===
Total: 2 items, 41.1GB

Move all items to Trash? [y/N]
```

### 5. Confirm deletion

Type `y` and press Enter. Items move to Trash (not permanently deleted).

Results are logged to `data/history.json` for the AI to see on next run.

## Available Tools

The AI has access to these tools:

### Exploration
- **list_directory** - See what's in a directory
- **get_disk_usage** - Disk space overview
- **find_large_items** - Find files/directories above a size threshold
- **get_item_info** - Detailed info on a specific path

### Discovery
- **list_applications** - Installed apps with last-opened dates
- **list_homebrew** - Homebrew packages
- **list_docker** - Docker images, containers, volumes

### Staging
- **stage_for_deletion** - Add to deletion list
- **unstage** - Remove from deletion list
- **get_staged** - View staged items

## Configuration

### Protected Paths

Paths in `protected_paths` cannot be staged. Protection is recursive — if `~/Documents` is protected, so is `~/Documents/subfolder`.

The `~` character expands to your home directory.

### Scan Locations

`scan_locations` tells the AI where to look. It's a suggestion, not a restriction — the AI can explore elsewhere if needed.

### Dry Run

Set `"dry_run": true` in config.json to make the delete script only show what would happen without actually moving anything to Trash.

## Safety Features

1. **No AI delete capability** - Deletion script is separate and manual
2. **Protected paths** - Critical directories cannot be staged
3. **Trash, not permanent** - Items go to Trash, recoverable
4. **Confirmation required** - You must type 'y' to proceed
5. **Size limit** - `max_delete_size_gb` prevents huge accidental deletions
6. **History logging** - All deletions logged to `data/history.json`

## Development

```bash
npm run dev          # Run with ts-node
npm run build        # Compile TypeScript
npm start            # Run compiled version
npm run delete       # Execute deletion script
```

## Troubleshooting

**Server won't start:**
- Check that `config.json` exists
- Verify Node.js version (20+)
- Check Claude Desktop logs: `~/Library/Logs/Claude/mcp*.log`

**AI says path is protected:**
- Check `protected_paths` in your config.json
- Remember protection is recursive

**Delete script fails:**
- Install `jq`: `brew install jq`
- Check file permissions on the items
- Some system files may require admin privileges

**Can't find tools in Claude:**
- Restart Claude Desktop fully (Cmd+Q, then reopen)
- Check the config file path is absolute
- Verify the build succeeded (`npm run build`)

## Architecture

See [DESIGN.md](DESIGN.md) for detailed architecture decisions and tool specifications.

## License

MIT
