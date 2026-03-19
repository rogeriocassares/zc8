# Versioning Strategy

This document describes the versioning strategy for the zc8 monorepo, particularly for Go packages.

## Overview

The zc8 monorepo uses **unified versioning** across all packages. This means:

- All packages share a single version number
- Releases are atomic—all packages are released together
- Version is maintained in the root `VERSION` file
- Git tags use the format: `v<major>.<minor>.<patch>`

## Current Version

See [VERSION](./VERSION) file for the current version.

## Version Format

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

Example: `0.1.0`, `1.2.3`

## Go Packages

All Go packages in `packages/go-*` use the same version:

```
packages/go-cache/go.mod       → module version managed via git tags
packages/go-config/go.mod      → module version managed via git tags
packages/go-identity/go.mod    → module version managed via git tags
packages/go-infra/go.mod       → module version managed via git tags
packages/go-parser/go.mod      → module version managed via git tags
packages/go-stream/go.mod      → module version managed via git tags
packages/go-util/go.mod        → module version managed via git tags
packages/go-uuid/go.mod        → module version managed via git tags
```

When consuming these packages from other repos, use the git tag:

```bash
go get github.com/rogeriocassares/zc8/packages/go-cache@v0.1.0
```

## Release Process

### 1. Update Version

Update the `VERSION` file:

```bash
echo "0.2.0" > VERSION
```

### 2. Commit Changes

Commit all changes for this release:

```bash
git add .
git commit -m "chore: release v0.2.0"
```

### 3. Create Git Tag

Create a git tag for the release:

```bash
git tag -a v0.2.0 -m "Release version 0.2.0"
git push origin v0.2.0
```

### 4. Trigger CI/CD

Push to trigger any automated release workflows:

```bash
git push origin develop
```

## CI/CD Integration

Add the following to your CI/CD pipeline:

```bash
# Read version
VERSION=$(cat VERSION)

# Tag all changes
git tag -a "v${VERSION}" -m "Release version ${VERSION}"
git push origin "v${VERSION}"
```

## Monorepo Benefits

This unified versioning approach provides:

- ✅ Simplified coordination across packages
- ✅ Atomic releases—all packages updated together
- ✅ Clear version history in git tags
- ✅ Easy to understand and maintain
- ✅ Predictable dependency versions

## Future Considerations

If individual package versioning becomes necessary:

- Consider tools like [Lerna](https://lerna.js.org/) (for JS packages) or [cargo-workspaces](https://crates.io/crates/cargo-workspaces)
- Implement independent git tags: `go-cache/v1.0.0`, `go-config/v2.0.0`, etc.
- Update CI/CD to detect per-package changes

For now, **unified versioning keeps the monorepo maintainable**.

## References

- [Semantic Versioning](https://semver.org/)
- [Go Modules](https://golang.org/doc/modules/version-numbers)
- [Turborepo Documentation](https://turbo.build/)
