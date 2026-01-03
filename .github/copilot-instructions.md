# macOS SSD MCP - AI Agent Rules

## Project Context

**What:** MCP server for AI-assisted disk cleanup on macOS.  
**Philosophy:** AI explores and suggests, user deletes. AI has NO delete capability.  
**Design doc:** `DESIGN.md` (read this first)

## How to Work

### Discuss Before Doing
- **New features/tools:** Propose and discuss before implementing
- **Architecture changes:** Update DESIGN.md first, get approval
- **Bug fixes:** Can proceed directly, but explain what you're fixing

### Keep It Simple
- Obvious code > clever code
- Don't over-engineer — this is a ~10 tool MCP server
- If a solution feels complex, step back and discuss

### Communication Style
- Be direct, skip fluff
- When proposing changes, give options with tradeoffs
- If you're unsure, say so and ask
- Don't explain things the user already knows

### When You Hit Problems
- Try to solve it yourself first
- If stuck, explain what you tried and what failed
- Don't silently give up — say "I couldn't figure out X because Y"

## Critical Constraints

### Security Model
The entire security model depends on this separation:
- ✅ AI can explore filesystem
- ✅ AI can stage items for deletion
- ❌ AI cannot delete anything
- ❌ AI cannot execute the delete script

**Never** add a delete tool to the MCP server. Deletion happens via `scripts/delete-staged.sh` which is outside AI's reach.

### Protected Paths
The config has `protected_paths`. Staging tools MUST refuse to stage any path matching these. This is a hard requirement, not a suggestion.

## Project Structure

```
src/
├── index.ts              # Entry point
├── server.ts             # MCP server setup
├── config/               # Config loading
├── tools/
│   ├── exploration.ts    # list_directory, get_disk_usage, find_large_items, get_item_info
│   ├── discovery.ts      # list_applications, list_homebrew, list_docker
│   └── staging.ts        # stage_for_deletion, unstage, get_staged
└── utils/                # Shared helpers
scripts/
└── delete-staged.sh      # Manual deletion (NOT an MCP tool)
data/                     # Runtime data (gitignored)
```

## Development Rules

### Before Coding
1. Read `DESIGN.md` for tool specifications
2. Check if your change affects the security model
3. For new tools: discuss first, add to DESIGN.md, then implement

### Error Handling
Return errors as tool results, not exceptions:
```typescript
// ✅ Correct
return { success: false, error: "Path not found", code: "PATH_NOT_FOUND" };

// ❌ Wrong
throw new Error("Path not found");
```
This lets the AI see and react to errors.

### Testing
- Test tools manually with MCP Inspector before committing
- Test protected paths are actually protected
- Test error cases return proper error objects

### Commits
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`
- Reference what tool/component: `feat(staging): add reason field to staged items`
- Commit when user asks, or when a logical unit of work is complete
- Never push without asking
- Never use `git add -A` or `git add .` — stage specific files

## Adding New Tools

1. **Discuss first** - propose in chat
2. **Update DESIGN.md** - document inputs/outputs
3. **Implement** - in appropriate file under `src/tools/`
4. **Register** - add to `src/server.ts`
5. **Test** - verify with MCP Inspector

## Files Reference

| File | Purpose | Protected? |
|------|---------|------------|
| `DESIGN.md` | Architecture decisions | Update with discussion |
| `config.sample.json` | Default config template | Yes - changes need discussion |
| `scripts/delete-staged.sh` | Manual deletion | Yes - security critical |
| `src/tools/staging.ts` | Staging logic | Security-sensitive |

## Quick Commands

```bash
npm run dev          # Run in development
npm run build        # Compile TypeScript
npm start            # Run compiled version
./scripts/delete-staged.sh  # Execute staged deletions (manual only)
```
