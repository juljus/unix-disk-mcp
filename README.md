# unix-disk-mcp

AI-assisted disk cleanup for Unix systems (macOS and Linux). Let an LLM explore your filesystem, identify unused files, and suggest what to delete. **You stay in control** — the AI can only suggest and stage items, never delete them.

## Why?

Traditional disk cleaners use fixed rules. This tool lets AI *reason* about your actual usage:
- "3 Node.js installations via different methods"
- "40GB VM untouched for 14 months"
- "Docker images for deleted projects"
- "Homebrew packages nothing depends on"

## Security

The AI **cannot delete files**. Ever. This is architectural:
- ✅ Explore filesystem
- ✅ Suggest items to delete
- ✅ Stage items for deletion
- ❌ Cannot execute deletion
- ❌ Cannot run delete script

You run `unix-disk-mcp delete` manually to review and confirm.

## Install

```bash
npm install -g unix-disk-mcp
unix-disk-mcp setup
```

The setup wizard configures everything. Or manually:

**1. Add to MCP client config:**

VS Code: `~/.config/Code/User/mcp.json` (Linux) or `~/Library/Application Support/Code/User/mcp.json` (macOS)
```json
{
  "servers": {
    "unix-disk-mcp": {
      "type": "stdio",
      "command": "unix-disk-mcp"
    }
  }
}
```

Claude Desktop: `~/.config/Claude/claude_desktop_config.json` (Linux) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
```json
{
  "mcpServers": {
    "unix-disk-mcp": {
      "command": "unix-disk-mcp"
    }
  }
}
```

**2. Configure protected paths:**

Run `unix-disk-mcp config` to see config location, then edit:
```json
{
  "protected_paths": ["/System", "/Library", "~/.ssh", "~/.gnupg"],
  "ignore_patterns": [".git"],
  "max_delete_size_gb": 10,
  "dry_run": false
}
```

## Usage

**1. Ask AI to explore:**
- "What's using disk space?"
- "Find large files I don't need"
- "Check for old Docker images"

**2. AI stages items:**
```
Staged for deletion:
1. ~/.cache/pip (2.3 GB)
2. ~/Downloads/old-installer.dmg (1.5 GB)
Total: 3.8 GB
```

**3. You delete manually:**
```bash
unix-disk-mcp delete
# Reviews staged items, requires typing HUMAN, then y/N confirmation
```

## Tools Available to AI

**Exploration:**
- `list_directory` - Browse folders
- `get_disk_usage` - Disk space overview
- `find_large_items` - Find big files/folders (supports progressive depth exploration)
- `get_item_info` - Details on specific paths

**Discovery:**
- `list_applications` - Installed apps with last-opened dates (macOS only)
- `list_homebrew` - Homebrew packages
- `list_docker` - Docker images, containers, volumes

**Staging:**
- `stage_for_deletion` - Mark for deletion
- `unstage` - Remove from staging
- `get_staged` - View staged items

## Platform Support

**macOS:**
- Trash via AppleScript
- Accurate APFS disk usage (diskutil)
- App discovery via Spotlight

**Linux:**
- Trash via gio/trash-cli/freedesktop spec
- Disk usage via df
- App discovery not yet implemented (use find_large_items on app directories)

## Safety Features

1. AI cannot delete (architecturally separated)
2. Terminal check (blocks piped input)
3. Human verification required (type "HUMAN")
4. Protected paths cannot be staged
5. Items go to Trash (recoverable)
6. Deletion requires manual terminal command
7. Confirmation prompt before deletion
8. Deletion history logged

## Commands

```bash
unix-disk-mcp          # Start MCP server (default)
unix-disk-mcp setup    # Setup wizard
unix-disk-mcp delete   # Delete staged items (manual only)
unix-disk-mcp config   # Show config location
unix-disk-mcp help     # Show help
```

## Config & Data

- **Config:** `~/.config/unix-disk-mcp/config.json`
- **Staged items:** `~/.local/share/unix-disk-mcp/staged.json`
- **History:** `~/.local/share/unix-disk-mcp/history.json`

## License

MIT
