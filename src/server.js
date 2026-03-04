/**
 * The core server that runs on a Cloudflare worker.
 */

import {
	InteractionResponseType,
	InteractionType,
	MessageFlags,
} from 'discord-api-types/v10';
import { verifyKey } from 'discord-interactions';
import { AutoRouter } from 'itty-router';
import { generateMessageClip } from './clip.js';
import { CLIP_COMMAND, SILENT_CLIP_COMMAND } from './commands.js';

/**
 * @typedef {Object} Env
 * @property {string} DISCORD_PUBLIC_KEY
 * @property {string} DISCORD_APPLICATION_ID
 */

class JsonResponse extends Response {
	constructor(body, init) {
		const jsonBody = JSON.stringify(body);
		init = init || {
			headers: {
				'content-type': 'application/json;charset=UTF-8',
			},
		};
		super(jsonBody, init);
	}
}

const router = AutoRouter();

router.get('/', (_request, env) => {
	return new Response(null, {
		status: 301,
		headers: {
			Location: `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}`,
			'Cache-Control': 'max-age=3600', // Cache for 1 hour
		},
	});
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/interactions', async (request, env, ctx) => {
	const { isValid, interaction } = await server.verifyDiscordRequest(
		request,
		env,
	);
	if (!isValid || !interaction) {
		return new Response('Bad request signature.', { status: 401 });
	}

	if (interaction.type === InteractionType.Ping) {
		// The `PING` message is used during the initial webhook handshake, and is
		// required to configure the webhook in the developer portal.
		return new JsonResponse({
			type: InteractionResponseType.Pong,
		});
	}

	if (interaction.type === InteractionType.ApplicationCommand) {
		// Most user commands will come as `APPLICATION_COMMAND`.
		switch (interaction.data.name.toLowerCase()) {
			case CLIP_COMMAND.name.toLowerCase(): {
				ctx.waitUntil(generateMessageClip(interaction, env));

				return new JsonResponse({
					type: InteractionResponseType.DeferredChannelMessageWithSource,
				});
			}
			case SILENT_CLIP_COMMAND.name.toLowerCase(): {
				ctx.waitUntil(generateMessageClip(interaction, env));

				return new JsonResponse({
					type: InteractionResponseType.DeferredChannelMessageWithSource,
					data: {
						flags: MessageFlags.Ephemeral,
					},
				});
			}
			default:
				return new JsonResponse({ error: 'Unknown Application Command' }, { status: 400 });
		}
	}

	console.error('Unknown Type');
	return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});
router.all('*', () => new Response('Not Found.', { status: 404 }));

/**
 * Verify the incoming request from Discord.
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<{interaction?: import('discord-api-types/v10').APIInteraction, isValid: boolean}>}
 */
async function verifyDiscordRequest(request, env) {
	const signature = request.headers.get('x-signature-ed25519');
	const timestamp = request.headers.get('x-signature-timestamp');
	const body = await request.text();
	const isValidRequest =
		signature &&
		timestamp &&
		(await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
	if (!isValidRequest) {
		return { isValid: false };
	}

	return { interaction: JSON.parse(body), isValid: true };
}

const server = {
	verifyDiscordRequest,
	fetch: router.fetch,
};

export default server;
