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
```

## Layout

The design is "workhorse, edges and substrate":
- **The workhorse:** `js/chat.js`, which handles the URL hash, view
  switching, SSE and navigation.
- **The edges:** self-contained widgets that each own their DOM and CSS,
  such as search, compose, the sidebars and help.
- **The substrate:** shared pieces that self-style, so they drop into other
  pages. They include `message.js`, `message_view.js`, `nav_stack.js` and the
  popups.

The history before this repository is angry-gopher's (`chat/*.js`); it was
split out with `git filter-branch`, so `git log --follow` reaches back
through it.

## Not here yet

- **The JS lint** (`jsparse.py`, `lint.py`) and the syntax check still run
  from angry-gopher's `ops/test_chat`, against this checkout.
- **The wire contract the client relies on** is not written down here yet:
  the URLs, the SSE frames, the JSON payloads, and the rendered markdown's
  classes.
