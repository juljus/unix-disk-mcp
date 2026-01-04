# NPM Package Conversion - TODO

## Overview
Convert from local project to installable npm package with proper CLI and setup wizard.

## Name Change
- Rename project from `macos-ssd-mcp` to `macos-storage-mcp`
- Update all references in code, config, and docs

## File Locations

### Current (local)
- Config: `./config.json`
- Data: `./data/`

### Target (npm package)
- Config: `~/.config/macos-storage-mcp/config.json`
- Data: `~/.local/share/macos-storage-mcp/staged.json`, `history.json`

### Changes needed
- [ ] Update `src/config/index.ts` to use XDG config directory
- [ ] Update `src/tools/staging.ts` to use XDG data directory
- [ ] Create directories on first run if they don't exist
- [ ] Copy `config.sample.json` to config location on first run

## CLI Commands

Create `bin/macos-storage-mcp.ts` as main entry point:

```
macos-storage-mcp              # Run MCP server (default)
macos-storage-mcp setup        # Interactive setup wizard
macos-storage-mcp delete       # Execute deletion script
macos-storage-mcp config       # Show/edit config
```

### Delete Script (TypeScript)
- [ ] Convert `scripts/delete-staged.sh` to TypeScript
- [ ] Port bash functionality:
  - Interactive terminal check (`process.stdin.isTTY`)
  - Human verification prompt
  - List staged items with formatting
  - Single y/N confirmation
  - Move to Trash via AppleScript
  - Log results to history.json
- [ ] Use packages:
  - `chalk` for colors
  - `inquirer` for prompts (or keep simple readline)
  - Native `child_process.execSync` for osascript

### Setup Wizard
- [ ] Create interactive config wizard
- [ ] Prompts:
  - Which directories to protect? (checkboxes with defaults)
  - Which MCP client? (VS Code / Claude Desktop / Both / Neither)
  - Max deletion size? (default 10GB)
- [ ] Auto-update MCP client config files
- [ ] Show completion message with next steps

## Package.json Updates

```json
{
  "name": "macos-storage-mcp",
  "bin": {
    "macos-storage-mcp": "./dist/bin/macos-storage-mcp.js"
  },
  "files": [
    "dist/**/*",
    "config.sample.json"
  ],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "chalk": "^5.0.0",
    "inquirer": "^9.0.0"
  }
}
```

## README Updates
- [ ] Installation: `npm install -g macos-storage-mcp`
- [ ] Setup: `macos-storage-mcp setup`
- [ ] Usage workflow with new command names
- [ ] MCP config example updated to use global command

## Testing
- [ ] Test global install: `npm install -g .`
- [ ] Test `macos-storage-mcp` runs server
- [ ] Test `macos-storage-mcp setup` creates config
- [ ] Test `macos-storage-mcp delete` works
- [ ] Test config/data directories are created
- [ ] Test with actual MCP client

## Publishing
- [ ] Set up npm account if needed
- [ ] Add license info
- [ ] Add repository URL
- [ ] `npm publish`

## Migration Path
For existing local installations, provide migration instructions:
1. Run `macos-storage-mcp setup` after global install
2. Copy staged items if any exist in old location
3. Update MCP config to use new command
