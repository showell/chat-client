# chat-client

The browser client of Gopher Chat (lynrummy.com/chat): hand-written
JavaScript with no build step, served verbatim by the chat's host.

## Use

A Zig package: add it to your `build.zig.zon` and import the module
`chat_client`. `js/bundles.zig` lists each script with its bytes, and a host
serves them at `/chat/<name>`.

To swap in another client, keep the names the pages ask for. Pages import
scripts by name, and a missing name fails the host's build.

```
zig build test                      # the bundle table
node tools/test_chat_resize.mjs     # the photo resize decision
node tools/test_contract.mjs        # the contract with the server
```

## The contract with the server

[`CONTRACT.md`](CONTRACT.md) is everything the client needs from the host:
the pages' elements and `data-*` attributes, the inline JSON, every request
and the answers it reads, the SSE streams and their frames, and the classes
of the rendered markdown, each field cited at the line that reads it.
[`contract/contract.json`](contract/contract.json) is the same contract,
machine-readable, with examples. `node tools/test_contract.mjs` runs the
scripts against those examples and fails when a field is not read under
its name, so a key renamed on one side and not the other fails here.

A server checks itself against the contract by running its own output
through the same tool, from a checkout of this repository: a page as
served, a stream as sent, or one answer.

```
node tools/test_contract.mjs --check-page conversation page.html
node tools/test_contract.mjs --check-stream topic stream.txt
node tools/test_contract.mjs --check sidebar_data sidebar.json
```

Each exits 0 when the output agrees, and names each disagreement and exits
1 when it does not. The pages, streams and payloads are named in
CONTRACT.md ("Checking a server").

## Layout

The design is "workhorse, edges and substrate":
- **The workhorse:** `js/chat.js`, which handles the URL hash, view
  switching, SSE and navigation.
- **The edges:** self-contained widgets that each own their DOM and CSS,
  such as search, compose, the sidebars and help.
- **The substrate:** shared pieces that self-style, so they drop into other
  pages. They include `message.js`, `message_view.js` and the popups.

The history before this repository is angry-gopher's (`chat/*.js`); it was
split out with `git filter-branch`, so `git log --follow` reaches back
through it.

## Not here yet

- **The JS lint** (`jsparse.py`, `lint.py`) and the syntax check still run
  from angry-gopher's `ops/test_chat`, against this checkout.
- **No server runs the contract check yet.** Each chat's tests would
  capture a page, a stream and the answers, and run them through
  `tools/test_contract.mjs` (above).
