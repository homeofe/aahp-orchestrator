# VS Code Marketplace Publishing Guide

## Prerequisites
1. Create a Personal Access Token (PAT) at https://dev.azure.com
   - Organization: elvatis (or your Azure DevOps org)
   - Scopes: Marketplace > Manage
2. Install vsce: `npm install -g @vscode/vsce`
3. Login: `vsce login elvatis`

## Publishing Steps
```bash
npm run compile
vsce package
vsce publish
```

## Current Config
- Publisher: elvatis
- Extension ID: aahp-orchestrator
- Version: 0.3.0

## Checklist Before Publish
- [ ] README.md updated
- [ ] CHANGELOG.md updated
- [ ] Icon set (128x128 PNG)
- [ ] All tests pass
- [ ] vsce package succeeds
- [ ] Azure DevOps PAT valid
