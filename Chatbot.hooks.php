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

		// A checkbox
		$preferences_key = 'chatbot-confirm-redirect';
		$preferences_default = $this->userOptionsLookup->getOption(
						$user,
						$preferences_key,
						$this->config->get( 'ChatbotPopupAssistentConfig' )["confirm_redirect"] );
		$preferences[$preferences_key] = [
			'type' => 'toggle',
			'help-message' => 'chatbot-confirm-redirect-help',
			'label-message' => 'chatbot-confirm-redirect-label',
			'default' => $preferences_default,
			'section' => $your_new_extensions_section
		];

		// An string input box
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
			'section' => $your_new_extensions_section
		];


	}
}
