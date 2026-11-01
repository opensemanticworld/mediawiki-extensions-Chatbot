/**
 * The assistant's end of the JupyterLite sandbox.
 *
 * The sandbox lives in a **hidden iframe on this page**, revealed when it is wanted.
 * It used to be a separate tab, and the tab had three problems worth naming because they
 * are the reasons for everything below:
 *
 * * a popup blocker can simply refuse it, and the first thing a new user met was an
 *   error telling them to go and change a browser setting;
 * * nothing could start until the user asked, so the whole ~40 second cold start landed
 *   in the middle of the conversation;
 * * a tab is a context switch away from the page the user was reading.
 *
 * An iframe fixes all three: it is never blocked, it can be created early so Python is
 * loading while the user is still typing, and it opens *next to* the thing they were
 * looking at.
 *
 * The cost, stated plainly: an iframe dies when the page navigates, so the kernel
 * restarts on the next wiki page. Notebooks survive - JupyterLite keeps the contents
 * drive in browser storage - but a running kernel does not. `popOut()` exists for work
 * that needs to outlive navigation.
 */
/* global mw, $ */
( function () {
	'use strict';

	var FRAME_ID = 'osw-sandbox-frame';
	var PANEL_ID = 'osw-sandbox-panel';
	// Named, so a popped-out sandbox can be found again from a later page in this tab.
	var WINDOW_NAME = 'osw_jupyterlite';
	// Survives navigation within the tab, which is exactly the case this is for.
	var POPPED_KEY = 'osw-sandbox-popped-out';

	// Each request carries one of these so a reply can be matched to it; the sandbox may
	// be answering several at once.
	var nextRequestId = 1;
	var pending = Object.create( null );
	var sandboxReady = false;
	var readyWaiters = [];
	var poppedOut = null;

	// Cold start plus the first import. Generous on purpose: the cost of waiting too long
	// is a slow answer, the cost of giving up too early is a second kernel.
	var READY_TIMEOUT_MS = 180000;
	var CALL_TIMEOUT_MS = 180000;

	function basePath() {
		return mw.config.get( 'wgJupyterLiteBasePath' ) || '';
	}

	function sandboxEnabled() {
		return !!mw.config.get( 'wgJupyterLiteBasePath' );
	}

	function panel() {
		return document.getElementById( PANEL_ID );
	}

	function frame() {
		return document.getElementById( FRAME_ID );
	}

	function targetWindow() {
		if ( poppedOut && !poppedOut.closed ) {
			return poppedOut;
		}
		var el = frame();
		return el ? el.contentWindow : null;
	}

	window.addEventListener( 'message', function ( event ) {
		if ( event.origin !== window.location.origin ) {
			return;
		}
		var data = event.data;
		if ( !data || typeof data !== 'object' ) {
			return;
		}
		if ( data.type === 'osw-sandbox-ready' ) {
			sandboxReady = true;
			readyWaiters.splice( 0 ).forEach( function ( resolve ) {
				resolve();
			} );
			return;
		}
		if ( data.type === 'osw-sandbox-reply' && pending[ data.id ] ) {
			var entry = pending[ data.id ];
			delete pending[ data.id ];
			clearTimeout( entry.timer );
			entry.resolve( data.error ? { ok: false, error: data.error } : data.result );
		}
	} );

	/**
	 * Resolve the notebook argument to something the sandbox will accept.
	 *
	 * Only wiki files, and only through img_auth.php - the sandbox enforces the same
	 * rule, because a notebook opened there runs with the reader's rights and an
	 * arbitrary url would be a way to have somebody edit the wiki without noticing.
	 *
	 * @param {string} notebook a File: page title, or empty
	 * @return {Promise<string|null>} a url, or null for an empty sandbox
	 */
	async function notebookUrl( notebook ) {
		if ( !notebook ) {
			return null;
		}
		var title = String( notebook ).trim().replace( /^:/, '' );
		if ( !/^File:/i.test( title ) ) {
			throw new Error(
				"only notebooks uploaded to this wiki can be opened - pass a 'File:...ipynb' page title"
			);
		}
		var data = await new mw.Api().get( {
			action: 'query',
			prop: 'imageinfo',
			iiprop: 'url',
			titles: title,
			formatversion: 2
		} );
		var page = ( ( data.query || {} ).pages || [] )[ 0 ];
		var url = page && page.imageinfo && page.imageinfo[ 0 ] && page.imageinfo[ 0 ].url;
		if ( !url ) {
			throw new Error( title + ' is not an uploaded file on this wiki' );
		}
		return url;
	}

	function labUrl( fileUrl ) {
		return basePath() + 'lab/index.html' +
			( fileUrl ? '?fromURL=' + encodeURIComponent( fileUrl ) : '' );
	}

	/**
	 * Create the sandbox if it does not exist yet. Hidden unless asked to show.
	 *
	 * Idempotent, and deliberately cheap to call early: starting it while the user is
	 * still typing is the whole reason the cold start stops being felt.
	 *
	 * @param {Object} [options]
	 * @param {string} [options.fileUrl] notebook to load, for a sandbox not yet created
	 * @param {boolean} [options.show] reveal it as well
	 * @return {HTMLElement} the panel
	 */
	function ensure( options ) {
		options = options || {};
		if ( poppedOut && !poppedOut.closed ) {
			// Already running in its own window; a second one in an iframe would be two
			// kernels and two places to look.
			if ( options.fileUrl ) {
				request( 'open_url', { url: options.fileUrl } );
			}
			poppedOut.focus();
			return null;
		}
		var existing = panel();
		if ( !existing ) {
			var $panel = $( '<div>' )
				.attr( 'id', PANEL_ID )
				.addClass( 'osw-sandbox-panel osw-sandbox-hidden' );

			var $header = $( '<div>' ).addClass( 'osw-sandbox-header' );
			$( '<span>' ).addClass( 'osw-sandbox-title' )
				.text( mw.msg( 'chatbot-sandbox-title' ) ).appendTo( $header );
			$( '<button>' ).addClass( 'osw-sandbox-btn' )
				.attr( 'title', mw.msg( 'chatbot-sandbox-popout' ) )
				.text( '↗' )
				.on( 'click', popOut ).appendTo( $header );
			$( '<button>' ).addClass( 'osw-sandbox-btn' )
				.attr( 'title', mw.msg( 'chatbot-sandbox-hide' ) )
				.text( '×' )
				.on( 'click', hide ).appendTo( $header );
			$header.appendTo( $panel );

			$( '<iframe>' )
				.attr( 'id', FRAME_ID )
				.attr( 'title', mw.msg( 'chatbot-sandbox-title' ) )
				.attr( 'src', labUrl( options.fileUrl ) )
				.appendTo( $panel );

			$panel.appendTo( document.body );
			existing = $panel[ 0 ];
		} else if ( options.fileUrl ) {
			// Already running: load the notebook through the bridge rather than
			// reloading the frame, which would throw away a warm kernel.
			request( 'open_url', { url: options.fileUrl } );
		}
		if ( options.show ) {
			show();
		}
		return existing;
	}

	function show() {
		var el = ensure();
		if ( !el ) {
			return; // popped out: it is already its own window
		}
		el.classList.remove( 'osw-sandbox-hidden' );
		document.body.classList.add( 'osw-sandbox-open' );
	}

	function hide() {
		var el = panel();
		if ( el ) {
			el.classList.add( 'osw-sandbox-hidden' );
		}
		document.body.classList.remove( 'osw-sandbox-open' );
	}

	function isVisible() {
		var el = panel();
		return !!el && !el.classList.contains( 'osw-sandbox-hidden' );
	}

	/**
	 * Move the sandbox into its own tab, for work that must outlive navigation.
	 *
	 * The iframe is torn down when the user clicks any wiki link; this is the escape
	 * hatch for a long computation. Notebooks are kept in browser storage either way, so
	 * what is lost on navigation is the running kernel, not the work.
	 *
	 * @return {Window|null}
	 */
	function popOut() {
		var handle = window.open( labUrl(), WINDOW_NAME );
		if ( !handle ) {
			mw.notify( mw.msg( 'chatbot-sandbox-popup-blocked' ), { type: 'warn' } );
			return null;
		}
		poppedOut = handle;
		sandboxReady = false;
		try {
			window.sessionStorage.setItem( POPPED_KEY, '1' );
		} catch ( e ) {}
		// The iframe would otherwise keep a second kernel alive, invisibly.
		var el = panel();
		if ( el ) {
			el.remove();
		}
		hide();
		return handle;
	}

	/**
	 * Re-attach to a popped-out sandbox after the wiki page navigated.
	 *
	 * The window survives navigation; the handle to it does not, because this script is
	 * re-evaluated on every page. Without this the assistant would lose a running
	 * sandbox the user can still see, and quietly start a second one in an iframe.
	 *
	 * `window.open` with an **empty** url returns an existing window of that name
	 * without navigating it, which is what makes re-attaching free - a url here would
	 * reload the lab and throw away the kernel this exists to preserve.
	 */
	function adoptPoppedOut() {
		var flagged;
		try {
			flagged = window.sessionStorage.getItem( POPPED_KEY );
		} catch ( e ) {
			return;
		}
		if ( !flagged ) {
			return;
		}
		var handle = window.open( '', WINDOW_NAME );
		if ( !handle || handle.closed ) {
			try { window.sessionStorage.removeItem( POPPED_KEY ); } catch ( e ) {}
			return;
		}
		// If no such window existed, window.open just made a blank one - close it rather
		// than leave the user with a stray tab.
		var blank = false;
		try {
			blank = !handle.location || handle.location.href === 'about:blank';
		} catch ( e ) {
			// Cross-origin means it is a real page, not one we just created.
			blank = false;
		}
		if ( blank ) {
			handle.close();
			try { window.sessionStorage.removeItem( POPPED_KEY ); } catch ( e ) {}
			return;
		}
		poppedOut = handle;
		// We missed its ready announcement, so ask instead. A reply also confirms it is
		// our sandbox and not some other window that happened to take the name.
		request( 'status' ).then( function ( result ) {
			if ( result && result.ok !== false ) {
				sandboxReady = true;
				readyWaiters.splice( 0 ).forEach( function ( resolve ) {
					resolve();
				} );
			} else {
				poppedOut = null;
				try { window.sessionStorage.removeItem( POPPED_KEY ); } catch ( e ) {}
			}
		} );
	}

	/**
	 * Wait for the sandbox to announce itself.
	 *
	 * `onProgress` is called while waiting so the caller can keep the backend's deadline
	 * open; without it a cold start reads as a failed tool call.
	 *
	 * @param {Function} [onProgress]
	 * @return {Promise<boolean>} false if it never became ready
	 */
	function whenReady( onProgress ) {
		if ( sandboxReady ) {
			return Promise.resolve( true );
		}
		return new Promise( function ( resolve ) {
			var ticker = setInterval( function () {
				if ( onProgress ) {
					onProgress();
				}
			}, 10000 );
			var done = function ( value ) {
				clearInterval( ticker );
				clearTimeout( timer );
				resolve( value );
			};
			var timer = setTimeout( function () {
				done( false );
			}, READY_TIMEOUT_MS );
			readyWaiters.push( function () {
				done( true );
			} );
		} );
	}

	function request( action, payload ) {
		var target = targetWindow();
		if ( !target ) {
			return Promise.resolve( { ok: false, error: 'the sandbox is not open' } );
		}
		var id = 'req-' + nextRequestId++;
		return new Promise( function ( resolve ) {
			pending[ id ] = {
				resolve: resolve,
				timer: setTimeout( function () {
					delete pending[ id ];
					resolve( { ok: false, error: 'the sandbox did not answer in time' } );
				}, CALL_TIMEOUT_MS )
			};
			target.postMessage(
				Object.assign( { type: 'osw-sandbox-request', id: id, action: action }, payload ),
				window.location.origin
			);
		} );
	}

	/**
	 * Start the sandbox quietly, so the cold start overlaps the conversation.
	 *
	 * Only when the wiki has enabled it for this user *and* the assistant may use it -
	 * loading a Python runtime for somebody who will never open it would be rude.
	 */
	function warmUp() {
		if ( !sandboxEnabled() ) {
			return;
		}
		var actions = mw.config.get( 'wgChatbotActions' ) || [];
		if ( actions.indexOf( 'code-sandbox' ) === -1 ) {
			return;
		}
		ensure();
	}

	// Before anything asks: a popped-out sandbox from an earlier page in this tab is
	// still running, and the assistant should talk to that rather than start another.
	adoptPoppedOut();

	mw.osw = mw.osw || {};
	mw.osw.sandbox = {
		isEnabled: sandboxEnabled,
		basePath: basePath,
		notebookUrl: notebookUrl,
		ensure: ensure,
		show: show,
		hide: hide,
		popOut: popOut,
		warmUp: warmUp,
		whenReady: whenReady,
		request: request,
		isOpen: function () {
			return !!targetWindow();
		},
		isVisible: isVisible,
		isPoppedOut: function () {
			return !!( poppedOut && !poppedOut.closed );
		},
		isReady: function () {
			return sandboxReady;
		}
	};
}() );
