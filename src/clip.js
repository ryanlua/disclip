/**
 * Generates HTML content for a Discord message and then uses Puppeteer to take a screenshot of it.
 */

import puppeteer from '@cloudflare/puppeteer';
import index from '../public/index.html';
import style from '../public/style.css';
import { CLIP_COMPONENT, ERROR_COMPONENT } from './components.js';

/**
 * Generate a message screenshot from a Discord interaction.
 * @param {import('discord-api-types/v10').APIInteraction} interaction - The Discord interaction object.
 * @param {*} env - The environment variables.
 * @returns {Promise<Buffer>} - The screenshot image buffer.
 */
async function generateMessageScreenshot(interaction, env) {
	// Pick random session from open sessions
	let sessionId = await getRandomSession(env.BROWSER);
	let browser;
	if (sessionId) {
		try {
			browser = await puppeteer.connect(env.BROWSER, sessionId);
		} catch (sessionError) {
			// another worker may have connected first
			console.warn(`Failed to connect to ${sessionId}. Error ${sessionError}`);
		}
	}
	if (!browser) {
		try {
			// No open sessions, launch new session
			browser = await puppeteer.launch(env.BROWSER);
		} catch (browserError) {
			console.error('Browser launch failed:', browserError);
			throw browserError;
		}
	}

	sessionId = browser.sessionId(); // get current session id

	// Generate the screenshot
	const page = await browser.newPage();
	await page.setContent(index);
	await page.addStyleTag({ content: style });
	await page.addScriptTag({
		url: 'https://cdn.jsdelivr.net/npm/@twemoji/api@latest/dist/twemoji.min.js',
	});

	await page.evaluate((interaction) => {
		const targetId = interaction.data.target_id;
		const message = interaction.data.resolved.messages[targetId];
		const member = interaction.data.resolved.members?.[message.author.id];
		const guildId = interaction.guild_id;
		const author = message.author;
		const username = member?.nick || author.global_name || author.username;
		const defaultUserAvatarIndex = author.discriminator
			? Number(author.discriminator) % 5 // Legacy username system
			: (BigInt(author.id) >> 22n) % 6n; // New username system
		const userAvatar =
			member?.avatar && guildId
				? `https://cdn.discordapp.com/guilds/${guildId}/users/${author.id}/avatars/${member.avatar}.webp`
				: author.avatar
					? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.webp`
					: `https://cdn.discordapp.com/embed/avatars/${defaultUserAvatarIndex}.png`;
		const effectiveAvatarDecoration =
			member?.avatar_decoration_data || author.avatar_decoration_data;
		const avatarDecoration = effectiveAvatarDecoration
			? `https://cdn.discordapp.com/avatar-decoration-presets/${effectiveAvatarDecoration.asset}.png?passthrough=false`
			: '';
		const serverTag = author.clan?.tag || '';
		const serverTagBadge = author.clan
			? `https://cdn.discordapp.com/guild-tag-badges/${author.clan.identity_guild_id}/${author.clan.badge}.webp`
			: '';
		const botTag = author.bot;

		// TODO: Move this parsing to a separate function/module
		// Parse message content and replace markdown with HTML
		const messageContent = message.content
			.replace(
				/<a?:([^:>]+):(\d+)>/g,
				'<img src="https://cdn.discordapp.com/emojis/$2.webp" alt="$1" class="emoji">',
			) // custom emojis
			.replace(/^### (.+)$/gm, '<h3>$1</h3>') // ### header 3
			.replace(/^## (.+)$/gm, '<h2>$1</h2>') // ## header 2
			.replace(/^# (.+)$/gm, '<h1>$1</h1>') // # header 1
			.replace(/^-# (.+)$/gm, '<small>$1</small>') // -# subtext
			.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>') // > blockquote
			.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>') // [text](url)
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // **bold**
			.replace(/__(.+?)__/g, '<u>$1</u>') // __underline__
			.replace(/(\*|_)(.+?)\1/g, '<em>$2</em>') // *italic* or _italic_
			.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>') // ||spoiler||
			.replace(/~~(.+?)~~/g, '<del>$1</del>') // ~~strikethrough~~
			.replace(/```([^`]+?)```/g, '<pre>$1</pre>') // ```code block```
			.replace(/`([^`]+)`/g, '<code>$1</code>') // `inline code`
			.replace(/\n/g, '<br>'); // change \n to <br> for line breaks

		const avatarElement = document.querySelector('.avatar');
		avatarElement.setAttribute('src', userAvatar);

		const avatarDecorationElement =
			document.querySelector('.avatar-decoration');
		avatarDecorationElement.setAttribute('src', avatarDecoration);

		const usernameElement = document.querySelector('.username');
		usernameElement.firstChild.textContent = username;

		const serverTagElement = document.getElementById('server-tag');
		if (serverTag) {
			serverTagElement.querySelector('span').textContent = serverTag;
			serverTagElement.querySelector('img').setAttribute('src', serverTagBadge);
		} else {
			serverTagElement.style.display = 'none';
		}

		const botTagElement = document.getElementById('bot-tag');
		if (!botTag) {
			botTagElement.style.display = 'none';
		}

		// Set message element
		const messageElement = document.querySelector('.message');
		messageElement.innerHTML = messageContent;

		// Parse message element with Twemoji
		const twemoji = window.twemoji;
		twemoji.parse(messageElement, {
			folder: 'svg',
			ext: '.svg',
		});
	}, interaction);

	// Wait for images to load
	await page.waitForNetworkIdle();

	// Set the viewport size based on the card element
	const cardElement = await page.$('.card');
	const cardBoundingBox = await cardElement.boundingBox();
	await page.setViewport({
		width: Math.ceil(cardBoundingBox.width + 200),
		height: Math.ceil(cardBoundingBox.height + 200),
		deviceScaleFactor: 2,
	});

	const screenshot = await page.screenshot({
		optimizeForSpeed: true,
	});

	// All work done, so free connection (IMPORTANT!)
	browser.disconnect();

	return screenshot;
}

/**
 * Get a random session ID from the available sessions.
 * @todo Fix this when developing locally, where it will error because it can't get sessions while local.
 * @param {import("@cloudflare/puppeteer").BrowserWorker} endpoint
 * @return {Promise<string|undefined>} - The session ID or undefined if no sessions are available.
 * @see {@link https://developers.cloudflare.com/browser-rendering/workers-bindings/reuse-sessions/}
 */
async function getRandomSession(endpoint) {
	const sessions = await puppeteer.sessions(endpoint);
	const sessionsIds = sessions
		.filter((v) => {
			return !v.connectionId; // remove sessions with workers connected to them
		})
		.map((v) => {
			return v.sessionId;
		});
	if (sessionsIds.length === 0) {
		return;
	}

	const sessionId = sessionsIds[Math.floor(Math.random() * sessionsIds.length)];

	return sessionId;
}

/**
 * Generate a message clip from a Discord interaction.
 * @param {import('discord-api-types/v10').APIInteraction} interaction - The Discord interaction object.
 * @param {*} env - The environment variables.
 */
export async function generateMessageClip(interaction, env) {
	let formData;
	let msgJson;
	try {
		const targetId = interaction.data.target_id;
		const targetMessage = interaction.data.resolved.messages[targetId];
		const image = await generateMessageScreenshot(interaction, env);
		const messageUrl = `https://discord.com/channels/${interaction.guild_id || '@me'}/${targetMessage.channel_id}/${targetMessage.id}`;

		msgJson = CLIP_COMPONENT(messageUrl);

		formData = new FormData();
		formData.append('payload_json', JSON.stringify(msgJson));
		formData.append('files[0]', new Blob([image]), 'clip.png');
	} catch (error) {
		console.error('Error generating message clip:', error);

		msgJson = ERROR_COMPONENT(error.stack || 'Unknown error occurred');

		formData = new FormData();
		formData.append('payload_json', JSON.stringify(msgJson));
	} finally {
		const discordUrl = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`;
		const discordResponse = await fetch(discordUrl, {
			method: 'POST',
			body: formData,
		});
		if (!discordResponse.ok) {
			console.error(
				'Failed to send followup to discord',
				discordResponse.status,
			);
			const json = await discordResponse.json();
			console.error({
				response: json,
				msgJson: JSON.stringify(msgJson),
			});
		}
	}
}
