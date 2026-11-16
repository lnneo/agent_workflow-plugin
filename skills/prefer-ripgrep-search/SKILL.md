---
name: prefer-ripgrep-search
description: Prefer ripgrep (`rg`) over `grep` for searching text, files, and codebases. Use this skill when you need to find symbols, strings, files, usages, TODOs, imports, configs, or implementation details inside a repository or directory.
---

# Prefer ripgrep (`rg`) for Codebase Search

## Goal

When searching inside a project, repository, or directory, prefer `rg` from ripgrep instead of `grep` because `rg` is designed for fast recursive search and respects `.gitignore` by default.

Use `grep` only as a fallback when `rg` is unavailable or when the user explicitly asks for `grep`.

## Why prefer `rg`

`ripgrep` is a line-oriented search tool that recursively searches the current directory for regex patterns. By default, it respects `.gitignore`, skips hidden files/directories, and skips binary files. This usually produces faster and cleaner code-search results than recursive `grep`.

## Default rule

Before using `grep`, check whether `rg` is available:

```bash
command -v rg >/dev/null 2>&1
```

If available, use `rg`. If not available, use `grep` as fallback.

## Common search commands

### Search text recursively

```bash
rg "PATTERN"
```

### Search in a specific path

```bash
rg "PATTERN" path/to/search
```

### Search exact plain text, not regex

Use `-F` when the search string contains special regex characters or should be treated literally.

```bash
rg -F "literal.text.or.$value"
```

### Search case-insensitively

```bash
rg -i "pattern"
```

### Smart case search

Use smart case when lowercase queries should be case-insensitive, but mixed/uppercase queries should be case-sensitive.

```bash
rg -S "pattern"
```

### Show only matching file names

```bash
rg -l "PATTERN"
```

### Show files that do not match

```bash
rg -L "PATTERN"
```

### Show line numbers

`rg` usually shows line numbers automatically in useful contexts, but you can force them:

```bash
rg -n "PATTERN"
```

### Show context around matches

```bash
rg -C 3 "PATTERN"
rg -A 5 "PATTERN"
rg -B 5 "PATTERN"
```

### Search by file type

```bash
rg -t php "class User"
rg -t js "useEffect"
rg -t ts "interface"
rg -t py "def "
```

Exclude a file type:

```bash
rg -T js "PATTERN"
```

List supported file types:

```bash
rg --type-list
```

### Search only specific globs

```bash
rg "PATTERN" -g "*.php"
rg "PATTERN" -g "*.{js,ts,tsx}"
```

### Exclude paths or files

```bash
rg "PATTERN" -g '!vendor/' -g '!node_modules/' -g '!dist/'
```

### Search hidden files

By default, `rg` skips hidden files and directories. Use `--hidden` when hidden files are relevant, such as `.env.example`, `.github/`, or config directories.

```bash
rg --hidden "PATTERN"
```

Avoid searching `.git` unless needed:

```bash
rg --hidden "PATTERN" -g '!.git/'
```

### Search ignored files

By default, `rg` respects ignore files such as `.gitignore`. Use this only when expected results may be inside ignored directories or files.

```bash
rg --no-ignore "PATTERN"
```

Use `-u`, `-uu`, or `-uuu` when progressively disabling filtering is needed:

```bash
rg -u "PATTERN"     # less filtering
rg -uu "PATTERN"    # include ignored files
rg -uuu "PATTERN"   # include ignored, hidden, and binary files
```

Prefer targeted searches before using broad unfiltered commands.

### List files quickly

Use `rg --files` instead of `find` for project-aware file listing.

```bash
rg --files
rg --files -g "*.php"
rg --files | rg "Controller"
```

### Count matches

```bash
rg -c "PATTERN"
rg --count-matches "PATTERN"
```

### Replace grep pipelines when possible

Prefer:

```bash
rg "PATTERN" path/to/search
```

Instead of:

```bash
grep -R "PATTERN" path/to/search
```

Prefer:

```bash
rg -n "PATTERN"
```

Instead of:

```bash
grep -RIn "PATTERN" .
```

Prefer:

```bash
rg -l "PATTERN"
```

Instead of:

```bash
grep -Rl "PATTERN" .
```

## Recommended AI behavior

When investigating a codebase:

1. Start with focused `rg` searches.
2. Use exact search with `-F` for literal strings.
3. Use `-t` or `-g` to narrow by language or file pattern.
4. Use `--hidden` only when hidden config files may matter.
5. Use `--no-ignore` or `-uuu` only when normal search misses expected results.
6. Avoid scanning dependency/build folders unless needed.
7. Prefer multiple targeted searches over one huge unrestricted search.

## Examples for common development tasks

### Find class or function definitions

```bash
rg -n "class PaymentService|function handlePayment|def handle_payment"
```

### Find Laravel routes

```bash
rg -n "Route::|->name\(" routes app
```

### Find environment variable usage

```bash
rg -n "STRIPE_|env\(" . -g "*.php" -g "*.env.example"
```

### Find TODO/FIXME comments

```bash
rg -n "TODO|FIXME|HACK|XXX"
```

### Find imports/usages

```bash
rg -n "PaymentRequestException|StripeService|UserSubscription"
```

### Find files by name

```bash
rg --files | rg "Payment|Subscription|Stripe"
```

## Fallback when `rg` is unavailable

Use `grep` only if `rg` is not installed:

```bash
grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=vendor "PATTERN" .
```

For file listing fallback:

```bash
find . -type f | grep "PATTERN"
```

## Safety and quality notes

- Do not use `rg -uuu` as the first search command in large repositories.
- Do not search binary files unless specifically needed.
- Be careful with secrets: searching for tokens, passwords, `.env`, or private keys should be limited to the user's own local/project files and should not print sensitive values unnecessarily.
- Prefer summarizing findings and file paths instead of dumping large outputs.
