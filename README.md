# context-bar

A Claude Code mod that draws your context window as a stacked bar above the prompt, one colour per `/context` category, so you can see usage without running `/context`.

```
◆ context                    212k of 1M · compacts at 950k  21%  $1.23
████▉███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│░░▒▒▒
▌ system prompt 3.4k 0.3%   ▌ messages 186k 19%   ▌ skills 2.2k 0.2%
```

- Coloured runs: the categories using the window, in `/context`'s theme colours
- `░` free space, `▒` autocompact buffer, `│` where auto-compaction kicks in
- The percentage turns yellow at 50% and red at 80%
- The session's cost so far, as `/cost` totals it, at the far right. Claude Code only reports cost in US dollars, so it is always shown in `$`

It refreshes at session start, after each tool call, after each turn and after compaction, using the local `summary` estimate (no token-count API requests), so figures can differ slightly from `/context`.

## Install

In a Claude Code terminal session:

```
/plugin install context-bar --marketplace fredrikbonde/claude-context-bar
```

Answer `y` to add the marketplace, then pick the user scope. The bar shows straight away and in every session after.

Mods are an early-access Claude Code feature; this was built on Claude Code 2.1.294.

## Use

`/context-bar` hides or shows the bar for the current session.

## Update

```
claude plugin update context-bar
```

then `/reload-plugins` in a running session.

## Develop

```
claude plugin validate .
claude plugin test .
```
