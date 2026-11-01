/**
 * The assistant's end of the JupyterLite sandbox.
 *
 * The sandbox is a separate document the wiki opens. This holds the window handle, talks
 * to the bridge inside it over postMessage, and turns that into the four tools the
 * backend offers: open_sandbox, create_notebook, run_in_sandbox, sandbox_status.
 *
 * Two things shape the design.
 *
 * **A cold start is slow.** Roughly forty seconds while Python and the OSW packages load
 * into the browser. The backend's client-tool budget is sixty, so a request that simply
 * waited would be a coin flip - and a timeout tells the model the tool failed, which
 * makes it try again and start a second kernel. So the window is opened once and reused,
 * readiness is awaited through the bridge's own announcement rather than polled, and
 * `function_call_progress` is sent while waiting so the backend stops its clock.
 *
 * **Code runs as the user.** The sandbox shares the wiki's origin and therefore the
 * reader's session, so anything executed there can edit the wiki in their name. Running
 * is gated on the `code-sandbox` action and confirmed every single time. That dialog is
 * the only thing standing between a prompt injection in page content and a wiki edit.
 */
/* global mw, $ */
( function () {
    'use strict';

    // Each request carries one of these so a reply can be matched to it; the sandbox may
    // be answering several at once.
    var nextRequestId = 1;
    var pending = Object.create( null );
    var sandboxWindow = null;
    var sandboxReady = false;
    var readyWaiters = [];

    // Cold start plus the first import. Generous on purpose: the cost of waiting too
    // long is a slow answer, the cost of giving up too early is a second kernel.
    var READY_TIMEOUT_MS = 180000;
    var CALL_TIMEOUT_MS = 180000;

    function basePath() {
        return mw.config.get( 'wgJupyterLiteBasePath' ) || '/w/extensions/JupyterLite/dist/';
    }

    function sandboxEnabled() {
        return !!mw.config.get( 'wgJupyterLiteBasePath' );
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
        var api = new mw.Api();
        var data = await api.get( {
            action: 'query',
            prop: 'imageinfo',
            iiprop: 'url',
            titles: title,
            format: 'json',
            formatversion: 2
        } );
        var page = ( ( data.query || {} ).pages || [] )[ 0 ];
        var url = page && page.imageinfo && page.imageinfo[ 0 ] && page.imageinfo[ 0 ].url;
        if ( !url ) {
            throw new Error( title + ' is not an uploaded file on this wiki' );
        }
        return url;
    }

    function openWindow( url ) {
        if ( sandboxWindow && !sandboxWindow.closed ) {
            if ( url ) {
                sandboxWindow.location = url;
                sandboxReady = false;
            }
            sandboxWindow.focus();
            return sandboxWindow;
        }
        sandboxReady = false;
        sandboxWindow = window.open( url, 'osw_jupyterlite' );
        return sandboxWindow;
    }

    /**
     * Wait for the sandbox to announce itself.
     *
     * `onProgress` is called while waiting so the caller can keep the backend's
     * deadline open; without it a cold start reads as a failed tool call.
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
        if ( !sandboxWindow || sandboxWindow.closed ) {
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
            sandboxWindow.postMessage(
                Object.assign( { type: 'osw-sandbox-request', id: id, action: action }, payload ),
                window.location.origin
            );
        } );
    }

    mw.osw = mw.osw || {};
    mw.osw.sandbox = {
        isEnabled: sandboxEnabled,
        basePath: basePath,
        notebookUrl: notebookUrl,
        openWindow: openWindow,
        whenReady: whenReady,
        request: request,
        isOpen: function () {
            return !!( sandboxWindow && !sandboxWindow.closed );
        },
        isReady: function () {
            return sandboxReady;
        }
    };
}() );
