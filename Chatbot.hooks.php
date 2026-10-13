<?php
/**
 * Hooks for Chatbot extension
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\Chatbot;

use MediaWiki\Preferences\Hook\GetPreferencesHook;

use GlobalVarConfig;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\UserOptionsLookup;

class ChatbotHooks {

	public static function onBeforePageDisplay( $out ) {

		$out->addModules( 'ext.osw.ui.chatbot' );

		return true;

	}

	// see https://www.mediawiki.org/wiki/Manual:Hooks/ResourceLoaderGetConfigVars
	public static function onResourceLoaderGetConfigVars( array &$vars, $skin, $config ): void {
		$vars['wgChatbotPopupAssistentConfig'] = $config->get( 'ChatbotPopupAssistentConfig' );
		// Note: never expose $wgChatbotSecret here - this ends up in cached
		// page output. Per-user tokens are issued by action=chatbottoken.
		$vars['wgChatbotAllowedBackendOrigins'] = $config->get( 'ChatbotAllowedBackendOrigins' );
		// Raw config only: this hook runs on the load.php entry point, where
		// sessions are disabled and touching the user throws. ResourceLoader
		// output is also shared between users, so a per-user value would be
		// wrong here anyway - the rights filtering happens in the token.
		$vars['wgChatbotActions'] = $config->get( 'ChatbotActions' );
		$vars['wgChatbotConfirmActions'] = $config->get( 'ChatbotConfirmActions' );
		// Core does not expose this one, and the assistant needs to know: with
		// personal JS disabled a User:<name>/*.js page can be saved but is never
		// loaded, so a component would silently never run.
		$vars['wgAllowUserJs'] = (bool)$config->get( 'AllowUserJs' );
	}

	/**
	 * The actions the assistant may perform, minus the ones this user could not
	 * perform anyway. Keeping the rights check here means the client does not
	 * have to guess, and a user without 'delete' is never offered deletion.
	 *
	 * This is convenience, not enforcement - MediaWiki checks the rights again
	 * on every write.
	 *
	 * Never call this without a user from a context where sessions may be
	 * disabled (load.php): resolving the user there throws
	 * "Sessions are disabled for load entry point".
	 *
	 * @param \Config $config
	 * @param \User|null $user null skips the rights filtering
	 * @return string[]
	 */
	public static function getActions( $config, $user = null ): array {
		$actions = $config->get( 'ChatbotActions' );
		if ( !is_array( $actions ) ) {
			return [];
		}
		if ( $user === null ) {
			return array_values( $actions );
		}
		$pm = MediaWikiServices::getInstance()->getPermissionManager();

		$required = [
			'edit' => 'edit',
			'delete' => 'delete',
			'script' => 'editmyuserjs',
		];
		return array_values( array_filter( $actions, static function ( $action ) use ( $required, $pm, $user ) {
			if ( !isset( $required[$action] ) ) {
				return true;
			}
			return $pm->userHasRight( $user, $required[$action] );
		} ) );
	}

	public static function onParserFirstCallInit( &$parser ) {
		// important: This needs 	
		// "ExtensionMessagesFiles": { "ChatbotMagic": "Chatbot.i18n.magic.php" }
		// in extension.json

		$parser->setFunctionHook( 'chatbot', [ self::class, 'doSomething' ] );
	}

	/**
	 * @param Parser &$parser
	 * @param string &$text
	 * @return true
	 */
	public static function doSomething( &$parser, &$text ) {
		// Called in MW text like this: {{#chatbot: }}

		// For named parameters like {{#chatbot: foo=bar | apple=orange | banana }}
		// See: https://www.mediawiki.org/wiki/Manual:Parser_functions#Named_parameters

		return "This text will be shown when calling this in MW text.";
	}
}

class ChatbotPreferencesHooks implements GetPreferencesHook {

	private GlobalVarConfig $config;
	private UserOptionsLookup $userOptionsLookup;

	public function __construct(
		GlobalVarConfig $config,
		UserOptionsLookup $userOptionsLookup
	) {
		$this->config = $config;
		$this->userOptionsLookup = $userOptionsLookup;
	}

	public function onGetPreferences( $user, &$preferences ) {

		$your_new_extensions_section = 'chatbot';

		// Which of the enabled actions ask before they run. Offered as a
		// multi-select over the actions this wiki allows at all, so a user
		// cannot "confirm" something the assistant can never do anyway.
		$actions = ChatbotHooks::getActions( $this->config, $user );
		if ( $actions !== [] ) {
			$preferences_key = 'chatbot-confirm-actions';
			$preferences_default = $this->userOptionsLookup->getOption(
							$user,
							$preferences_key,
							implode( "\n", $this->config->get( 'ChatbotConfirmActions' ) ) );
			$options = [];
			foreach ( $actions as $action ) {
				// e.g. chatbot-action-websearch
				$options[wfMessage( 'chatbot-action-' . $action )->text()] = $action;
			}
			$preferences[$preferences_key] = [
				'type' => 'multiselect',
				'help-message' => 'chatbot-confirm-actions-help',
				'label-message' => 'chatbot-confirm-actions-label',
				'options' => $options,
				'default' => is_array( $preferences_default )
					? $preferences_default
					: array_filter( explode( "\n", (string)$preferences_default ) ),
				'section' => $your_new_extensions_section
			];
		}

		// An string input box.
		// Only offered when an allowlist is configured: this preference hands
		// the whole postMessage tool channel - page content, file downloads,
		// redirects - to whatever origin is entered here.
		$allowedOrigins = $this->config->get( 'ChatbotAllowedBackendOrigins' );
		if ( !is_array( $allowedOrigins ) || $allowedOrigins === [] ) {
			return;
		}

		$preferences_key = 'chatbot-custom-backend-iframe-src';
		$preferences_default = $this->userOptionsLookup->getOption(
						$user,
						$preferences_key,
						$this->config->get( 'ChatbotPopupAssistentConfig' )["iframe_src"] );
		$preferences[$preferences_key] = [
			'type' => 'text',
			'help-message' => 'chatbot-custom-backend-iframe-src-help',
			'label-message' => 'chatbot-custom-backend-iframe-src-label',
			//'maxLength' => 4,
			'default' => $preferences_default,
			'section' => $your_new_extensions_section,
			'validation-callback' => static function ( $value ) use ( $allowedOrigins ) {
				if ( $value === null || $value === '' ) {
					return true;
				}
				$parts = parse_url( $value );
				if ( !$parts || !isset( $parts['scheme'], $parts['host'] ) ) {
					return wfMessage( 'chatbot-custom-backend-iframe-src-invalid' );
				}
				$origin = $parts['scheme'] . '://' . $parts['host']
					. ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
				if ( !in_array( $origin, $allowedOrigins, true ) ) {
					return wfMessage( 'chatbot-custom-backend-iframe-src-invalid' );
				}
				return true;
			}
		];


	}
}
