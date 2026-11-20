# chat-client

The browser client of Gopher Chat, the chat in
[angry-gopher](https://github.com/showell/angry-gopher): plain JavaScript,
with no framework and no build step, served as written by the chat's host.

The code here was written by AI coding agents (Claude), with human supervision.
Point an agent at this repo to extend it.

## Use

A Zig package: add it to your `build.zig.zon` and import the module
`chat_client`. `js/bundles.zig` lists each script with its bytes, and a host
serves them at `/chat/<name>`.

To swap in another client, keep the names the pages ask for. Pages import
scripts by name, and a missing name fails the host's build.

```
tools/check                         # every check below, in one command
node tools/check_js_syntax.mjs js/*.js   # the scripts' syntax
python3 tools/lint.py               # the lint the `// lint:` markers answer to
node tools/test_chat_resize.mjs     # the photo resize decision
node tools/test_contract.mjs        # the contract with the server
zig build test                      # the bundle table
```

**The host pins this client.** angry-gopher names the commit it expects in
its `chat-client-rev` file, and its gate fails, naming both commits, when
its `../chat-client` checkout is at another. Building stays by path; a bump
is a one-line commit, made with the host's checks.

## The contract with the server

[`CONTRACT.md`](CONTRACT.md) is everything the client needs from the host:
the pages' elements and `data-*` attributes, the inline JSON, every request
and the answers it reads, the SSE streams and their frames, and the classes
of the rendered markdown, each field cited at the line that reads it.
[`contract/contract.json`](contract/contract.json) is the same contract,
machine-readable, with examples. `node tools/test_contract.mjs` runs the
scripts against those examples and fails when a field is read under
another name, so a key renamed on one side alone fails here.

A server checks itself against the contract by running its own output
through the same tool, from a checkout of this repository: a page as
served, a stream as sent, or one answer.

```
node tools/test_contract.mjs --check-page conversation page.html
node tools/test_contract.mjs --check-stream topic stream.txt
node tools/test_contract.mjs --check sidebar_data sidebar.json
```

Each exits 0 when the output agrees, and otherwise names each disagreement
and exits 1. The pages, streams and payloads are named in
CONTRACT.md ("Checking a server").

## Layout

The design is "workhorse, edges and substrate":
- **The workhorse:** `js/chat.js`, which handles the URL hash, view
  switching, SSE and navigation.
- **The edges:** self-contained widgets that each own their DOM and CSS,
  such as search, compose, the sidebars and help.
- **The substrate:** shared pieces that self-style, so they drop into other
  pages. They include `message.js`, `message_view.js` and the popups.

`git log --follow` reaches back into angry-gopher's history (`chat/*.js`),
where this code began.

## Next

- **A host runs the contract check against its own output**: its tests
  capture a page, a stream and the answers, and run them through
  `tools/test_contract.mjs` (above).
