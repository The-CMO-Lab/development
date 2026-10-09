# development

Claude Code mods for development workflows, published as a plugin marketplace.

## backlog-board

A sidebar pane in Claude Code that shows the progress of a project managed with the
[virtual-team](https://github.com/ovargas/virtual-team) skills, so you don't have to switch
between a browser board and the terminal.

It reads the project's docs folder as it is: `backlog.md`, `features/`, `decisions/` and
`handoffs/`. Nothing is copied or written back.

- **Overview** (`o`): percent done, counts by status (doing, verify, blocked, ready,
  parked), priority directives, the in-progress / verify / blocked lists, the next ready
  items and the latest handoff.
- **Features** (`f`): each open `FEAT-` with a done/total bar and its active stories.
- **Refresh** (`r`). It also refreshes on its own every 10 s, after every Claude turn, and
  when `features/`, `decisions/` or `handoffs/` change.

Statuses follow the backlog's markers (`[ ]`, `[>]`, `[=]`, `[~]`, `[x]`) and `status:`
fields, the same way virtual-team's `backlog-board.html` reads them.

### Install

In a Claude Code terminal session:

```
/plugin install backlog-board --marketplace The-CMO-Lab/development
```

Answer `y` to add the marketplace, then choose a scope (user scope loads it in every
session).

### Use

| Command | What it does |
| --- | --- |
| `/board` | Open the pane |
| `/board <docs folder>` | Point it at a project's docs folder (remembered per working directory) |
| `/board reset` | Forget that folder |
| `/board close` | Close the pane |

With no folder given, it looks for `./docs/backlog.md`, then `./backlog.md`, and opens the
pane by itself when it finds one. In fullscreen mode the pane docks beside the transcript
from 110 columns; narrower, it shows above the prompt.

Options, under `/config`: **Docs folder** (default: auto-detect) and **Refresh interval**
(seconds, default 10).

### Develop

```
claude --plugin-dir plugins/backlog-board   # run from this folder
claude plugin validate plugins/backlog-board
claude plugin test plugins/backlog-board
```
