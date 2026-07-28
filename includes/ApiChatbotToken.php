<?php
/**
 * Mints a short lived, signed token identifying the current user to the
 * chatbot backend.
 *
 * The backend is a separate service embedded as a cross-origin iframe, so it
 * has no access to the MediaWiki session and cannot tell who is talking to it.
 * This token closes that gap: it is signed with $wgChatbotSecret, which the
 * backend also knows (CHATBOT_SHARED_SECRET), and appended to the iframe url
 * by chatbot.js.
 *
 * Format: base64url(json{u,w,iat,exp,n}) "." base64url(hmac_sha256(payload))
 *
 * It is deliberately an API module rather than a ResourceLoader config var:
 * a per-user secret must never end up in cached page output, and this way the
 * client can fetch a fresh token whenever it needs one.
 *
 * @file
 * @ingroup Extensions
 */

namespace MediaWiki\Extension\Chatbot;

use ApiBase;

class ApiChatbotToken extends ApiBase {

	public function execute() {
		$config = $this->getConfig();
		$secret = $config->get( 'ChatbotSecret' );
		if ( !is_string( $secret ) || $secret === '' ) {
			// Not configured: the backend then runs without authentication.
			$this->dieWithError( 'apierror-chatbot-token-not-configured', 'notconfigured' );
		}

		$user = $this->getUser();
		$ttl = (int)$config->get( 'ChatbotTokenTtl' );
		$now = time();

		$payload = [
			// Anonymous users are not identified individually - the backend
			// only needs to know that the request came from this wiki.
			'u' => $user->isRegistered() ? $user->getName() : 'anon',
			'w' => $config->get( 'DBname' ),
			'iat' => $now,
			'exp' => $now + $ttl,
			'n' => bin2hex( random_bytes( 8 ) ),
		];

		$payloadB64 = self::base64UrlEncode( json_encode( $payload ) );
		$signature = self::base64UrlEncode(
			hash_hmac( 'sha256', $payloadB64, $secret, true )
		);

		$this->getResult()->addValue( null, $this->getModuleName(), [
			'token' => $payloadB64 . '.' . $signature,
			'expires' => $payload['exp'],
		] );
	}

	private static function base64UrlEncode( string $data ): string {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}

	public function getAllowedParams() {
		return [];
	}

	public function isReadMode() {
		return true;
	}

	protected function getExamplesMessages() {
		return [
			'action=chatbottoken' => 'apihelp-chatbottoken-example',
		];
	}
}
