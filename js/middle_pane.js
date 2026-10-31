/* ChatMiddlePane — the bubble-feed column.

   Owns its entire DOM + styling: wrapper, a navbar above the feed, the
   scrollable history surface, the inner bubble list. Owns MessageView
   internally. The navbar holds no button of its own: it is the strip
   siblings put their buttons in (chat_search's 🔍).

   Caller supplies a mount element (the layout slot where this column
   lives) and a renderBubble that builds one bubble from one message.
   The returned API mirrors MessageView's verbs plus the navbar handle. */
window.ChatMiddlePane = (function(){
  'use strict';

  var styleInjected = false;
  // lint:called-once init-once-guard
  function ensureStyles(){
    if(styleInjected) return; styleInjected = true;
    var s = document.createElement('style');
    /* :hover / :disabled / media-query — the rules that can't go through
       el.style. The rest of the column's styling is inline. */
    s.textContent =
        '.chat-mp-btn:hover:enabled { background:var(--cc-soft-border); }'
      + '.chat-mp-history:focus { outline:none; }'
      + '@media (orientation: landscape) { .chat-mp-main { flex:1; } }';
    document.head.appendChild(s);
  }

  function makeNavButton(opts){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-mp-btn';
    b.title = opts.title || '';
    if(opts.html) b.innerHTML = opts.html;
    else b.textContent = opts.label || '';
    Object.assign(b.style, {
      fontSize:'14px', lineHeight:1, padding:'3px 11px',
      background: ChatColors.softBorder, color: ChatColors.metaFg,
      border:'1px solid '+ChatColors.border, borderRadius:'4px', cursor:'pointer',
    });
    return b;
  }

  function init(opts){
    ensureStyles();
    var main         = opts.mount;
    var renderBubble = opts.renderBubble;
    var onSelect     = opts.onSelect || function(){};

    main.className = 'chat-mp-main';
    Object.assign(main.style, {
      minWidth:0, flex:1, maxWidth:'600px',
      display:'flex', flexDirection:'column', minHeight:0,
    });

    var navbar = document.createElement('div');
    Object.assign(navbar.style, { marginBottom:'8px' });

    var history = document.createElement('div');
    history.className = 'chat-mp-history';
    history.tabIndex = -1;
    Object.assign(history.style, {
      minWidth:0, flex:1, minHeight:0, overflowY:'auto',
      border:'1px solid '+ChatColors.border, borderRadius:'8px',
      padding:'12px', background: ChatColors.cardBg,
    });

    var bubbles = document.createElement('div');
    history.appendChild(bubbles);

    main.appendChild(navbar);
    main.appendChild(history);

    var view = MessageView.create({
      container:    history,
      list:         bubbles,
      renderBubble: renderBubble,
      /* PRODUCT_DECISION: forwarded for hosts that share the page with
         other arrow-key consumers.
         Defaults to false on the chat conversation page so arrows
         work without first focusing the feed. */
      scopeKeysToContainer: !!opts.scopeKeysToContainer,
      setSelectedBubble: function(idx){
        if(idx<=0) return;
        onSelect(idx);
      },
    });

    function caughtUp(){
      var els = bubbles.querySelectorAll('[data-i]');
      if(els.length === 0) return true;
      return els[els.length-1].getBoundingClientRect().bottom
        <= history.getBoundingClientRect().bottom + 1;
    }

    return {
      append:          view.append,
      focusBubble:     view.focusBubble,
      getSelected:     view.getSelected,
      cursorToExtreme: view.cursorToExtreme,
      startBacklog:    view.startBacklog,
      endBacklog:      view.endBacklog,
      caughtUp:        caughtUp,
      navbar:          navbar,
      bubbles:         bubbles,
      focus:           function(){ history.focus({preventScroll:true}); },
    };
  }

  /* makeNavButton is exported so sibling modules (e.g. chat_search's
     🔍) can build a button that matches the navbar's look without
     re-deriving the styles. */
  return { init: init, makeNavButton: makeNavButton };
})();
